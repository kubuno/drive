use bytes::Bytes;
use kubuno_db::dialect::Backend;
use kubuno_db::{params, DbPool, DbQueryBuilder, DbValue};
use kubuno_storage::{path as storage_path, unique_file_name, StorageBackend};
use mime_guess::MimeGuess;
use std::sync::Arc;
use uuid::Uuid;

use crate::services::null_safe_eq;
use crate::sync;
use crate::{
    errors::{FilesError, Result},
    models::{File, ListFilesQuery, MoveFileDto, RenameFileDto},
};

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Single-column projections used by a few list queries.
#[derive(sqlx::FromRow)]
struct NameOnly {
    name: String,
}
#[derive(sqlx::FromRow)]
struct IdName {
    id: Uuid,
    name: String,
}

/// Version-history aggregate, as two correlated scalar sub-selects over the
/// already-restricted set aliased `b`. It replaces a `LEFT JOIN LATERAL` (which
/// neither SQLite nor MariaDB has): a correlated sub-select in the projection is
/// portable and, like the lateral join, is evaluated once per output row — i.e.
/// after the paging, so at most the listing ceiling of lookups on
/// `idx_files_versions_file`, never a full aggregate of `drive.file_versions`.
fn version_stats_cols(b: Backend) -> String {
    format!(
        "(SELECT {vc} FROM drive.file_versions fv WHERE fv.file_id = b.id) AS version_count, \
         (SELECT {vb} FROM drive.file_versions fv WHERE fv.file_id = b.id) AS version_bytes",
        vc = b.count_bigint("*"),
        vb = b.sum_bigint("fv.size_bytes"),
    )
}

/// Runs a guarded `UPDATE` on `drive.files` that also stamps a **fresh**
/// `change_seq` (the portable replacement for the old BEFORE UPDATE trigger),
/// then returns the updated file with its version stats.
///
/// `set_sql` is the assignment list without `change_seq` and without the
/// `WHERE`; its placeholders run `$1..=$n` and `ps` holds those binds. The
/// helper appends `change_seq`, the id and the owner as `$n+1..=$n+3`. Because
/// `change_seq` always takes a new value, a matched row genuinely changes, so a
/// zero `rows_affected` unambiguously means "no such owned row" on every engine
/// (MySQL reports 0 for a no-op update — the fresh seq sidesteps that).
async fn update_file_returning(
    db: &DbPool,
    owner_id: Uuid,
    file_id: Uuid,
    set_sql: &str,
    mut ps: Vec<DbValue>,
) -> Result<File> {
    let mut tx = db.begin().await?;
    let seq = sync::next_seq(&mut tx).await?;
    let n = ps.len();
    let sql = format!(
        "UPDATE drive.files SET {set_sql}, change_seq = ${} WHERE id = ${} AND owner_id = ${}",
        n + 1,
        n + 2,
        n + 3
    );
    ps.push(DbValue::from(seq));
    ps.push(DbValue::from(file_id));
    ps.push(DbValue::from(owner_id));
    let affected = tx.execute(&sql, ps).await?;
    if affected == 0 {
        tx.rollback().await?;
        return Err(FilesError::NotFound(format!("Fichier {file_id} introuvable")));
    }
    tx.commit().await?;
    get_file(db, owner_id, file_id).await
}

/// Inserts a `drive.files` row with a fresh `change_seq`, the id minted by the
/// caller (no `RETURNING`/`gen_random_uuid()` on MySQL). `metadata` is always
/// bound (the JSON column has no portable literal default).
#[allow(clippy::too_many_arguments)]
async fn insert_file(
    db: &DbPool,
    id: Uuid,
    owner_id: Uuid,
    folder_id: Option<Uuid>,
    name: &str,
    extension: Option<String>,
    mime_type: &str,
    size: i64,
    storage_path_str: &str,
    content_hash: Option<&str>,
    metadata: serde_json::Value,
) -> Result<()> {
    let mut tx = db.begin().await?;
    let seq = sync::next_seq(&mut tx).await?;
    tx.execute(
        "INSERT INTO drive.files
            (id, owner_id, folder_id, name, extension, mime_type, size_bytes, storage_path, content_hash, metadata, change_seq)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        params![id, owner_id, folder_id, name, extension, mime_type, size, storage_path_str, content_hash, metadata, seq],
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Résout le nom définitif d'un fichier selon la politique de conflit choisie.
///
/// - `overwrite=true` : supprime le fichier existant et retourne le nom tel quel.
/// - `overwrite=false, strict=false` : renomme automatiquement avec numérotation (défaut).
/// - `overwrite=false, strict=true` : retourne HTTP 409 si un conflit existe.
pub async fn resolve_name(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    folder_id: Option<Uuid>,
    name: &str,
    overwrite: bool,
    strict: bool,
) -> Result<String> {
    let b = db.backend();
    if overwrite {
        let sql = format!(
            "SELECT * FROM drive.files
             WHERE owner_id = $1 AND {} AND name = $3 AND is_trashed = FALSE",
            null_safe_eq(b, "folder_id", 2)
        );
        let existing: Option<File> = db
            .fetch_optional_as::<File>(&sql, params![owner_id, folder_id, name])
            .await?;
        if let Some(f) = existing {
            delete_file_permanently(db, storage, owner_id, f.id).await?;
        }
        Ok(name.to_string())
    } else {
        let sql = format!(
            "SELECT name FROM drive.files
             WHERE owner_id = $1 AND {} AND is_trashed = FALSE",
            null_safe_eq(b, "folder_id", 2)
        );
        let existing_names: Vec<String> = db
            .fetch_all_as::<NameOnly>(&sql, params![owner_id, folder_id])
            .await?
            .into_iter()
            .map(|r| r.name)
            .collect();
        if strict && existing_names.iter().any(|n| n == name) {
            return Err(FilesError::Conflict(name.to_string()));
        }
        Ok(unique_file_name(name, &existing_names))
    }
}

/// Met à jour le quota consommé de l'utilisateur (delta positif = ajout, négatif = libération).
///
/// * `core.users.used_bytes` is adjusted by the delta (the authoritative figure).
/// * The owner is marked for the usage reporter (non-blocking; cannot fail the caller).
pub async fn update_used_bytes(db: &DbPool, owner_id: Uuid, delta: i64) {
    if let Err(e) = db
        .execute(
            "UPDATE core.users SET used_bytes = GREATEST(0, used_bytes + $1) WHERE id = $2",
            params![delta, owner_id],
        )
        .await
    {
        tracing::error!(owner_id = %owner_id, delta, error = %e, "Échec mise à jour used_bytes");
    }

    super::usage::mark_dirty(owner_id);
}

/// Récupère le chemin virtuel d'un dossier (vide = racine).
pub async fn folder_virt_path(db: &DbPool, folder_id: Option<Uuid>, owner_id: Uuid) -> Result<String> {
    match folder_id {
        None => Ok(String::new()),
        Some(fid) => db
            .fetch_optional_scalar::<String>(
                "SELECT path FROM drive.folders WHERE id = $1 AND owner_id = $2",
                params![fid, owner_id],
            )
            .await?
            .ok_or_else(|| FilesError::NotFound("Dossier cible introuvable".into())),
    }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub async fn create_file_record(
    db: &DbPool,
    owner_id: Uuid,
    folder_id: Option<Uuid>,
    name: &str,
    mime_type: &str,
    size_bytes: i64,
    storage_path_str: &str,
    content_hash: Option<&str>,
) -> Result<File> {
    let extension = std::path::Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());

    let id = kubuno_db::new_id();
    insert_file(
        db,
        id,
        owner_id,
        folder_id,
        name,
        extension,
        mime_type,
        size_bytes,
        storage_path_str,
        content_hash,
        serde_json::Value::Object(Default::default()),
    )
    .await?;

    update_used_bytes(db, owner_id, size_bytes).await;

    get_file(db, owner_id, id).await
}

/// Résout le nom final d'un UPLOAD et, en mode `overwrite`, retourne aussi le
/// fichier existant À REMPLACER EN PLACE (id conservé → références intactes).
pub async fn resolve_for_write(
    db: &DbPool,
    owner_id: Uuid,
    folder_id: Option<Uuid>,
    name: &str,
    overwrite: bool,
    strict: bool,
) -> Result<(String, Option<File>)> {
    let b = db.backend();
    if overwrite {
        let sql = format!(
            "SELECT * FROM drive.files
             WHERE owner_id = $1 AND {} AND name = $3 AND is_trashed = FALSE",
            null_safe_eq(b, "folder_id", 2)
        );
        if let Some(existing) = db
            .fetch_optional_as::<File>(&sql, params![owner_id, folder_id, name])
            .await?
        {
            return Ok((existing.name.clone(), Some(existing)));
        }
        return Ok((name.to_string(), None));
    }
    let sql = format!(
        "SELECT name FROM drive.files
         WHERE owner_id = $1 AND {} AND is_trashed = FALSE",
        null_safe_eq(b, "folder_id", 2)
    );
    let existing_names: Vec<String> = db
        .fetch_all_as::<NameOnly>(&sql, params![owner_id, folder_id])
        .await?
        .into_iter()
        .map(|r| r.name)
        .collect();
    if strict && existing_names.iter().any(|n| n == name) {
        return Err(FilesError::Conflict(name.to_string()));
    }
    Ok((unique_file_name(name, &existing_names), None))
}

/// Enregistre la ligne fichier après écriture du blob : INSERT, ou MISE À JOUR
/// EN PLACE (id préservé) quand `existing` est fourni (cas overwrite).
#[allow(clippy::too_many_arguments)]
pub async fn insert_or_update_record(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    folder_id: Option<Uuid>,
    name: &str,
    mime_type: &str,
    size: i64,
    storage_path_str: &str,
    content_hash: Option<&str>,
    metadata: Option<serde_json::Value>,
    existing: Option<File>,
) -> Result<File> {
    let extension = std::path::Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());

    if let Some(ex) = existing {
        if ex.storage_path != storage_path_str {
            let _ = storage.delete(&ex.storage_path).await;
        }
        let delta = size - ex.size_bytes;
        let updated = update_file_returning(
            db,
            owner_id,
            ex.id,
            "name = $1, extension = $2, mime_type = $3, size_bytes = $4, \
             storage_path = $5, content_hash = $6, metadata = COALESCE($7, metadata)",
            params![name, extension, mime_type, size, storage_path_str, content_hash, metadata],
        )
        .await?;
        if delta != 0 {
            update_used_bytes(db, owner_id, delta).await;
        }
        return Ok(updated);
    }

    let meta = metadata.unwrap_or(serde_json::Value::Object(Default::default()));
    let id = kubuno_db::new_id();
    insert_file(
        db,
        id,
        owner_id,
        folder_id,
        name,
        extension,
        mime_type,
        size,
        storage_path_str,
        content_hash,
        meta,
    )
    .await?;
    update_used_bytes(db, owner_id, size).await;
    get_file(db, owner_id, id).await
}

pub async fn list_files(db: &DbPool, owner_id: Uuid, query: ListFilesQuery) -> Result<Vec<File>> {
    let b = db.backend();
    let limit = query.limit.unwrap_or(100).min(1000);
    let offset = query.offset.unwrap_or(0);

    let trashed = query.trashed.unwrap_or(false);
    let is_recent = query.recent.unwrap_or(false);

    // Binds accumulate in placeholder order; never reuse a $n.
    let mut ps: Vec<DbValue> = vec![DbValue::from(owner_id), DbValue::from(trashed)];
    let mut q =
        String::from("SELECT ff.* FROM drive.files ff WHERE ff.owner_id = $1 AND ff.is_trashed = $2");
    let mut idx = 3usize;

    if let Some(fid) = query.folder_id {
        q.push_str(&format!(" AND ff.folder_id = ${idx}"));
        ps.push(DbValue::from(fid));
        idx += 1;
    } else if let Some(prefix) = query.folder_path_prefix.as_deref() {
        // Files whose folder path starts with the given prefix. owner_id is bound
        // again (a placeholder may not be reused).
        q.push_str(&format!(
            " AND ff.folder_id IN (SELECT id FROM drive.folders WHERE owner_id = ${} AND path LIKE ${})",
            idx,
            idx + 1
        ));
        ps.push(DbValue::from(owner_id));
        ps.push(DbValue::from(format!("{prefix}%")));
        idx += 2;
    } else if !is_recent && query.trashed.is_none() && query.starred.is_none() {
        q.push_str(" AND ff.folder_id IS NULL");
    }

    if let Some(s) = query.starred {
        q.push_str(&format!(" AND ff.is_starred = ${idx}"));
        ps.push(DbValue::from(s));
        idx += 1;
    }

    if let Some(mt) = query.mime_type.as_deref() {
        q.push_str(&format!(" AND {}", b.ilike("ff.mime_type", idx)));
        ps.push(DbValue::from(format!("{mt}%")));
        idx += 1;
    }

    if let Some(s) = query.search.as_deref() {
        q.push_str(&format!(" AND {}", b.ilike("ff.name", idx)));
        ps.push(DbValue::from(format!("%{s}%")));
        idx += 1;
    }

    let order = match query.sort_by.as_deref() {
        Some("size") => "size_bytes",
        Some("name") => "name",
        Some("updated") => "updated_at",
        _ if is_recent => "updated_at",
        _ => "created_at",
    };
    let order_dir = if query.sort_by.as_deref() == Some("name") { "ASC" } else { "DESC" };
    q.push_str(&format!(
        " ORDER BY ff.{order} {order_dir} LIMIT ${idx} OFFSET ${}",
        idx + 1
    ));
    ps.push(DbValue::from(limit));
    ps.push(DbValue::from(offset));

    // Page first, then attach the history aggregate of that page only.
    let outer = format!(
        "SELECT b.*, {cols} FROM ({q}) b ORDER BY b.{order} {order_dir}",
        cols = version_stats_cols(b),
    );

    let files = db
        .fetch_all_as::<File>(&outer, ps)
        .await
        .inspect_err(|e| tracing::error!(owner_id = %owner_id, error = %e, "Échec du listing des fichiers"))?;
    Ok(files)
}

pub async fn get_file(db: &DbPool, owner_id: Uuid, file_id: Uuid) -> Result<File> {
    let b = db.backend();
    let sql = format!(
        "SELECT b.*, {cols} FROM (SELECT * FROM drive.files WHERE id = $1 AND owner_id = $2) b",
        cols = version_stats_cols(b),
    );
    db.fetch_optional_as::<File>(&sql, params![file_id, owner_id])
        .await
        .inspect_err(|e| tracing::error!(file_id = %file_id, error = %e, "Échec de lecture du fichier"))?
        .ok_or_else(|| FilesError::NotFound(format!("Fichier {file_id} introuvable")))
}

pub async fn get_file_any_owner(db: &DbPool, file_id: Uuid) -> Result<File> {
    db.fetch_optional_as::<File>("SELECT * FROM drive.files WHERE id = $1", params![file_id])
        .await?
        .ok_or_else(|| FilesError::NotFound(format!("Fichier {file_id} introuvable")))
}

/// A file the user may READ: they own it, or it is internally shared with them.
pub async fn get_file_readable(db: &DbPool, user_id: Uuid, file_id: Uuid) -> Result<File> {
    let file = get_file_any_owner(db, file_id).await?;
    if file.owner_id == user_id
        || crate::services::shares::is_file_shared_with(db, user_id, file_id).await?
    {
        return Ok(file);
    }
    Err(FilesError::NotFound(format!("Fichier {file_id} introuvable")))
}

pub async fn rename_file(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    file_id: Uuid,
    dto: RenameFileDto,
) -> Result<File> {
    let name = dto.name.trim().to_string();
    if name.is_empty() || name.len() > 1000 {
        return Err(FilesError::Validation("Nom invalide".into()));
    }

    let file = get_file(db, owner_id, file_id).await?;
    let b = db.backend();

    let folder_id_for_resolve = file.folder_id;
    // Exclude the file itself so its own name is not treated as a conflict.
    let excl_sql = format!(
        "SELECT name FROM drive.files WHERE owner_id = $1 AND {} AND id != $3 AND is_trashed = FALSE",
        null_safe_eq(b, "folder_id", 2)
    );
    let existing_excl_self: Vec<String> = db
        .fetch_all_as::<NameOnly>(&excl_sql, params![owner_id, folder_id_for_resolve, file_id])
        .await?
        .into_iter()
        .map(|r| r.name)
        .collect();

    let name = if dto.overwrite {
        let dup_sql = format!(
            "SELECT * FROM drive.files WHERE owner_id = $1 AND {} AND name = $3 AND id != $4 AND is_trashed = FALSE",
            null_safe_eq(b, "folder_id", 2)
        );
        if let Some(existing) = db
            .fetch_optional_as::<File>(&dup_sql, params![owner_id, folder_id_for_resolve, &name, file_id])
            .await?
        {
            delete_file_permanently(db, storage, owner_id, existing.id).await?;
        }
        name
    } else if dto.strict && existing_excl_self.iter().any(|n| n == &name) {
        return Err(FilesError::Conflict(name));
    } else {
        unique_file_name(&name, &existing_excl_self)
    };

    let virt_path = folder_virt_path(db, file.folder_id, owner_id).await?;
    let new_storage = storage_path::user_file_path(owner_id, &virt_path, &name);
    let new_storage_str = new_storage.to_string_lossy().to_string();

    storage.mv(&file.storage_path, &new_storage_str).await?;

    let extension = std::path::Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());
    let mime = MimeGuess::from_path(&name).first_or_octet_stream().to_string();

    update_file_returning(
        db,
        owner_id,
        file_id,
        "name = $1, extension = $2, mime_type = $3, storage_path = $4",
        params![&name, extension, mime, &new_storage_str],
    )
    .await
}

pub async fn move_file(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    file_id: Uuid,
    dto: MoveFileDto,
) -> Result<File> {
    let file = get_file(db, owner_id, file_id).await?;

    let safe_name =
        resolve_name(db, storage, owner_id, dto.folder_id, &file.name, dto.overwrite, dto.strict).await?;

    let new_virt_path = folder_virt_path(db, dto.folder_id, owner_id).await?;
    let new_storage = storage_path::user_file_path(owner_id, &new_virt_path, &safe_name);
    let new_storage_str = new_storage.to_string_lossy().to_string();

    storage.mv(&file.storage_path, &new_storage_str).await?;

    update_file_returning(
        db,
        owner_id,
        file_id,
        "folder_id = $1, name = $2, storage_path = $3",
        params![dto.folder_id, &safe_name, &new_storage_str],
    )
    .await
}

pub async fn trash_file(db: &DbPool, owner_id: Uuid, file_id: Uuid) -> Result<File> {
    let existing = get_file(db, owner_id, file_id).await?;
    if existing.is_protected {
        return Err(FilesError::Protected(file_protected_msg(&existing.name)));
    }
    update_file_returning(
        db,
        owner_id,
        file_id,
        "is_trashed = $1, trashed_at = $2",
        params![true, chrono::Utc::now()],
    )
    .await
}

fn file_protected_msg(name: &str) -> String {
    format!("Le fichier « {name} » est protégé par une application (par exemple une exécution Flow en cours) et ne peut pas être supprimé pour le moment.")
}

// Active/désactive la protection d'un fichier (appelé par les modules via IPC).
pub async fn set_protected(db: &DbPool, owner_id: Uuid, file_id: Uuid, protected: bool) -> Result<File> {
    update_file_returning(db, owner_id, file_id, "is_protected = $1", params![protected]).await
}

pub async fn restore_file(db: &DbPool, owner_id: Uuid, file_id: Uuid) -> Result<File> {
    update_file_returning(
        db,
        owner_id,
        file_id,
        "is_trashed = $1, trashed_at = $2",
        params![false, None::<chrono::DateTime<chrono::Utc>>],
    )
    .await
}

pub async fn delete_file_permanently(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    file_id: Uuid,
) -> Result<()> {
    let file = get_file(db, owner_id, file_id).await?;
    if file.is_protected {
        return Err(FilesError::Protected(file_protected_msg(&file.name)));
    }

    if let Err(e) = storage.delete(&file.storage_path).await {
        tracing::warn!(path = %file.storage_path, error = %e, "Could not delete storage file");
    }

    if file.has_thumbnail {
        let thumb = storage_path::user_thumbnail_path(owner_id, file_id);
        if let Err(e) = storage.delete(&thumb.to_string_lossy()).await {
            tracing::warn!(error = %e, "Could not delete thumbnail");
        }
    }

    // Purge the version history explicitly so both the disk blobs and the quota
    // follow (the FK cascade alone would drop the rows and leak both).
    let history = crate::services::versions::purge_versions(db, storage, owner_id, file_id).await?;
    if history.removed > 0 {
        tracing::debug!(
            file_id = %file_id, removed = history.removed, freed = history.freed_bytes,
            "Historique de versions purgé avec le fichier",
        );
    }

    // Hard delete plus a tombstone, in one transaction, stamped with a fresh seq
    // so an offline client learns the file is gone (the old AFTER DELETE trigger).
    let mut tx = db.begin().await?;
    let seq = sync::next_seq(&mut tx).await?;
    tx.execute(
        "DELETE FROM drive.files WHERE id = $1 AND owner_id = $2",
        params![file_id, owner_id],
    )
    .await
    .inspect_err(|e| tracing::error!(file_id = %file_id, error = %e, "Échec de suppression du fichier"))?;
    sync::record_file_tombstone(&mut tx, file_id, owner_id, &file.name, seq).await?;
    tx.commit().await?;

    update_used_bytes(db, owner_id, -file.size_bytes).await;

    Ok(())
}

pub async fn toggle_star_file(db: &DbPool, owner_id: Uuid, file_id: Uuid) -> Result<File> {
    update_file_returning(db, owner_id, file_id, "is_starred = NOT is_starred", params![]).await
}

/// Met à jour la clé `open_with` dans le JSON `metadata` d'un fichier.
/// `module_id = None` supprime la préférence (retour au comportement par défaut).
pub async fn set_open_with(
    db: &DbPool,
    owner_id: Uuid,
    file_id: Uuid,
    module_id: Option<&str>,
) -> Result<File> {
    // Read-modify-write in Rust: jsonb_set / `- key` / to_jsonb are not portable.
    let file = get_file(db, owner_id, file_id).await?;
    let mut meta = match file.metadata {
        serde_json::Value::Object(m) => m,
        _ => serde_json::Map::new(),
    };
    match module_id {
        Some(m) => {
            meta.insert("open_with".into(), serde_json::Value::String(m.to_string()));
        }
        None => {
            meta.remove("open_with");
        }
    }
    update_file_returning(
        db,
        owner_id,
        file_id,
        "metadata = $1",
        params![serde_json::Value::Object(meta)],
    )
    .await
}

/// Met à jour les métadonnées utilisateur d'un fichier. Seuls les champs fournis
/// sont écrasés ; les champs absents sont conservés (fusion superficielle).
pub async fn update_user_metadata(
    db: &DbPool,
    owner_id: Uuid,
    file_id: Uuid,
    patch: serde_json::Value,
) -> Result<File> {
    let file = get_file(db, owner_id, file_id).await?;
    let mut meta = match file.metadata {
        serde_json::Value::Object(m) => m,
        _ => serde_json::Map::new(),
    };
    if let Some(patch_obj) = patch.as_object() {
        for (k, v) in patch_obj {
            meta.insert(k.clone(), v.clone());
        }
    }
    update_file_returning(
        db,
        owner_id,
        file_id,
        "metadata = $1",
        params![serde_json::Value::Object(meta)],
    )
    .await
}

/// Créer un fichier en écrivant les bytes en storage + enregistrement DB.
/// Utilisé par les modules qui génèrent du contenu (Office, PaintSharp…).
#[allow(clippy::too_many_arguments)]
pub async fn create_with_bytes(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    folder_id: Option<Uuid>,
    name: &str,
    mime_type: &str,
    data: Bytes,
    metadata: Option<serde_json::Value>,
    overwrite: bool,
) -> Result<File> {
    let (safe_name, existing) = resolve_for_write(db, owner_id, folder_id, name, overwrite, false).await?;

    let virt_path = folder_virt_path(db, folder_id, owner_id).await?;
    let dest = storage_path::user_file_path(owner_id, &virt_path, &safe_name);
    let dest_str = dest.to_string_lossy().to_string();
    let size = data.len() as i64;

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let hash = hex::encode(hasher.finalize());

    storage.put(&dest_str, data).await?;

    insert_or_update_record(
        db, storage, owner_id, folder_id, &safe_name, mime_type, size, &dest_str, Some(&hash), metadata, existing,
    )
    .await
}

/// Remplace le contenu d'un fichier existant (même chemin storage, taille/hash mis à jour).
pub async fn update_content_bytes(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    file_id: Uuid,
    data: Bytes,
) -> Result<File> {
    let file = get_file(db, owner_id, file_id).await?;
    let old_size = file.size_bytes;
    let new_size = data.len() as i64;

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let hash = hex::encode(hasher.finalize());

    storage.put(&file.storage_path, data).await?;

    let updated = update_file_returning(
        db,
        owner_id,
        file_id,
        "size_bytes = $1, content_hash = $2",
        params![new_size, &hash],
    )
    .await?;

    update_used_bytes(db, owner_id, new_size - old_size).await;

    Ok(updated)
}

/// Copier un fichier dans un dossier destination (en conservant l'original).
pub async fn copy_file(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    file_id: Uuid,
    folder_id: Option<Uuid>,
) -> Result<File> {
    let src = get_file(db, owner_id, file_id).await?;
    let b = db.backend();

    let sql = format!(
        "SELECT name FROM drive.files WHERE owner_id = $1 AND {} AND is_trashed = FALSE",
        null_safe_eq(b, "folder_id", 2)
    );
    let existing: Vec<String> = db
        .fetch_all_as::<NameOnly>(&sql, params![owner_id, folder_id])
        .await?
        .into_iter()
        .map(|r| r.name)
        .collect();

    let new_name = unique_file_name(&src.name, &existing);
    let virt_path = folder_virt_path(db, folder_id, owner_id).await?;
    let new_storage = storage_path::user_file_path(owner_id, &virt_path, &new_name);
    let new_storage_str = new_storage.to_string_lossy().to_string();

    storage.copy(&src.storage_path, &new_storage_str).await?;

    let file = create_file_record(
        db,
        owner_id,
        folder_id,
        &new_name,
        &src.mime_type,
        src.size_bytes,
        &new_storage_str,
        src.content_hash.as_deref(),
    )
    .await?;

    Ok(file)
}

/// Upload simple (fichier entier en une requête multipart).
#[allow(clippy::too_many_arguments)]
pub async fn upload_simple(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    folder_id: Option<Uuid>,
    filename: &str,
    data: Bytes,
    max_upload_bytes: u64,
    overwrite: bool,
) -> Result<File> {
    if data.len() as u64 > max_upload_bytes {
        return Err(FilesError::FileTooLarge);
    }

    let sanitized = sanitize_filename::sanitize(filename);
    if sanitized.is_empty() {
        return Err(FilesError::Validation("Nom de fichier invalide".into()));
    }

    let (safe_name, existing) = resolve_for_write(db, owner_id, folder_id, &sanitized, overwrite, false).await?;

    let mime = MimeGuess::from_path(&safe_name).first_or_octet_stream().to_string();
    let size = data.len() as i64;

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let hash = hex::encode(hasher.finalize());

    let virt_path = folder_virt_path(db, folder_id, owner_id).await?;
    let dest = storage_path::user_file_path(owner_id, &virt_path, &safe_name);
    let dest_str = dest.to_string_lossy().to_string();

    storage.put(&dest_str, data).await?;

    insert_or_update_record(
        db, storage, owner_id, folder_id, &safe_name, &mime, size, &dest_str, Some(&hash), None, existing,
    )
    .await
}

/// Noms de plusieurs fichiers en un appel (pour les listes des apps) → { id: name }.
pub async fn file_names(
    db: &DbPool,
    owner_id: Uuid,
    ids: &[Uuid],
) -> Result<std::collections::HashMap<Uuid, String>> {
    if ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    let mut qb = DbQueryBuilder::new(db.backend(), "SELECT id, name FROM drive.files WHERE owner_id = ");
    qb.push_bind(owner_id).push(" AND id").push_in(ids.iter().copied());
    let rows: Vec<IdName> = qb.fetch_all_as(db).await?;
    Ok(rows.into_iter().map(|r| (r.id, r.name)).collect())
}
