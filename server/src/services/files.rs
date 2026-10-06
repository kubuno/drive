use bytes::Bytes;
use kubuno_db::dialect::Backend;
use kubuno_db::{params, DbPool, DbQueryBuilder, DbValue};
use kubuno_storage::{path as storage_path, StorageBackend};
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

/// `name`, or the first free `name (n).ext` among `existing`, compared byte for byte: the numbering every
/// Drive client shares (kubuno-drive-core).
fn unique_file_name(name: &str, existing: &[String]) -> String {
    kubuno_drive_core::unique_name_among(name, false, existing, kubuno_drive_core::CaseRule::Sensitive)
}

/// Single-column projections used by a few list queries.
#[derive(sqlx::FromRow)]
struct NameOnly {
    name: String,
}
/// A blob some row pays for (a version's, typically).
#[derive(sqlx::FromRow)]
struct StoredBlob {
    storage_path: String,
    size_bytes: i64,
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
    let affected = tx.execute(&sql, ps).await.map_err(|e| {
        let e = FilesError::from(e);
        if is_unique_violation(&e) {
            // A concurrent write took the name in the meantime (one live file
            // per name and folder).
            FilesError::Conflict("un fichier porte déjà ce nom dans ce dossier".into())
        } else {
            tracing::error!(file_id = %file_id, error = %e, "Failed to update a file row");
            e
        }
    })?;
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
    // SQLite has no GREATEST; its two-argument MAX is the same scalar function.
    let sql = match db.backend() {
        Backend::Sqlite => "UPDATE core.users SET used_bytes = MAX(0, used_bytes + $1) WHERE id = $2",
        Backend::Postgres | Backend::MySql => {
            "UPDATE core.users SET used_bytes = GREATEST(0, used_bytes + $1) WHERE id = $2"
        }
    };
    if let Err(e) = db
        .execute(sql, params![delta, owner_id])
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

// ── One live file per name and folder ─────────────────────────────────────────
//
// The `files_live_name_unique` index (migration `live_name_unique`) forbids two
// live rows with the same owner, folder and name. Names are resolved before the
// insert, so the index only fires when a concurrent write took the name in the
// meantime; the insert paths then retry rather than fail.

/// Attempts per insert before giving up on a name taken again and again.
const MAX_INSERT_ATTEMPTS: usize = 5;

/// True when the error is a unique-constraint violation (any engine).
pub fn is_unique_violation(e: &FilesError) -> bool {
    matches!(e, FilesError::Database(sqlx::Error::Database(d)) if d.is_unique_violation())
}

/// Names of the live files of a folder.
async fn live_names(db: &DbPool, owner_id: Uuid, folder_id: Option<Uuid>) -> Result<Vec<String>> {
    let sql = format!(
        "SELECT name FROM drive.files WHERE owner_id = $1 AND {} AND is_trashed = FALSE",
        null_safe_eq(db.backend(), "folder_id", 2)
    );
    Ok(db
        .fetch_all_as::<NameOnly>(&sql, params![owner_id, folder_id])
        .await
        .inspect_err(|e| tracing::error!(owner_id = %owner_id, error = %e, "Failed to list the folder's names"))?
        .into_iter()
        .map(|r| r.name)
        .collect())
}

fn extension_of(name: &str) -> Option<String> {
    std::path::Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
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
    let mut name = name.to_string();
    for _ in 0..MAX_INSERT_ATTEMPTS {
        let id = kubuno_db::new_id();
        match insert_file(
            db,
            id,
            owner_id,
            folder_id,
            &name,
            extension_of(&name),
            mime_type,
            size_bytes,
            storage_path_str,
            content_hash,
            serde_json::Value::Object(Default::default()),
        )
        .await
        {
            Ok(()) => {
                release_reservation(storage_path_str);
                update_used_bytes(db, owner_id, size_bytes).await;
                return get_file(db, owner_id, id).await;
            }
            // A concurrent write took the name: number it, as the caller would have.
            Err(e) if is_unique_violation(&e) => {
                name = unique_file_name(&name, &live_names(db, owner_id, folder_id).await?);
            }
            Err(e) => {
                tracing::error!(owner_id = %owner_id, error = %e, "Failed to insert a file row");
                return Err(e);
            }
        }
    }
    Err(FilesError::Conflict(name))
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

// ── Storage locations ─────────────────────────────────────────────────────────
//
// A file's bytes live at its row's `storage_path`, which mirrors the virtual
// tree. The display name is unique only among the folder's NON-trashed files (a
// trashed `a.txt` does not stop a new `a.txt`), so the physical location cannot
// simply be derived from the name: two rows would share one blob, and writing,
// moving or deleting one would silently destroy the other. Every new location is
// therefore allocated here, against every row that still references bytes.

/// Upper bound on the numbered candidates tried for one location.
const MAX_LOCATION_CANDIDATES: usize = 1000;

/// How long an allocated location stays reserved for the write that got it.
/// Long enough for the slowest write (a large chunked upload being assembled)
/// to put its bytes and insert its row; by then the row references it.
const RESERVATION_TTL: std::time::Duration = std::time::Duration::from_secs(3600);

/// Locations handed out by [`allocate_storage_path`] whose row may not exist
/// yet. Checking the database and the disk is not enough on its own: two
/// concurrent writes would both find the same location free and write over each
/// other's bytes before either row exists. The reservation closes that window
/// within this process (the module runs as a single process per instance).
static RESERVED_LOCATIONS: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<String, std::time::Instant>>> =
    std::sync::LazyLock::new(Default::default);

/// Reserves `location` (by its file-system identity); false when another write
/// holds it.
fn try_reserve(location: &str) -> bool {
    let key = crate::services::blob_gc::fs_key(location);
    let now = std::time::Instant::now();
    // A poisoned lock only means another thread panicked mid-update; the map is
    // still a valid map.
    let mut map = RESERVED_LOCATIONS.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    map.retain(|_, at| now.duration_since(*at) < RESERVATION_TTL);
    if map.contains_key(&key) {
        return false;
    }
    map.insert(key, now);
    true
}

/// Ends a reservation once the row referencing the location is committed (the
/// database check covers it from then on).
fn release_reservation(location: &str) {
    let key = crate::services::blob_gc::fs_key(location);
    RESERVED_LOCATIONS.lock().unwrap_or_else(std::sync::PoisonError::into_inner).remove(&key);
}

/// Rejects a name that is not one plain path segment: the name becomes a segment
/// of the on-disk path, and a separator or a `..` would let it escape its folder
/// — or the owner's tree.
pub fn ensure_plain_name(name: &str) -> Result<()> {
    if !kubuno_drive_core::is_plain_segment(name) {
        return Err(FilesError::Validation("Nom de fichier invalide".into()));
    }
    Ok(())
}

/// Picks the storage path for bytes named `name` in the folder at `virt_path`:
/// `{owner}/files{virt_path}/{name}` when it is free, else the same name numbered
/// (`a (2).txt`, `a (3).txt`…). Free means referenced by no row — files, trashed
/// ones included, and versions — and absent from the storage (an unknown blob is
/// never overwritten; on a case-insensitive file system this also catches a
/// sibling differing only by case). Only the physical location is numbered: the
/// display name stays the caller's.
///
/// `own` is the row the bytes belong to (rename, move): its current location
/// counts as free when no OTHER row references it.
pub async fn allocate_storage_path(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    virt_path: &str,
    name: &str,
    own: Option<&File>,
) -> Result<String> {
    ensure_plain_name(name)?;
    let mut tried: Vec<String> = Vec::new();
    for _ in 0..MAX_LOCATION_CANDIDATES {
        let candidate_name = unique_file_name(name, &tried);
        let candidate = storage_path::user_file_path(owner_id, virt_path, &candidate_name)
            .to_string_lossy()
            .into_owned();
        let free = match own {
            Some(f) if f.storage_path == candidate => {
                !crate::services::blob_gc::is_referenced(db, owner_id, &candidate, Some(f.id)).await?
            }
            _ => {
                !crate::services::blob_gc::is_referenced(db, owner_id, &candidate, None).await?
                    && !storage.exists(&candidate).await?
                    && try_reserve(&candidate)
            }
        };
        if free {
            return Ok(candidate);
        }
        tried.push(candidate_name);
    }
    tracing::error!(owner_id = %owner_id, name, "No free storage location for the file");
    Err(FilesError::Conflict(name.to_string()))
}

/// Where to write new content for `name`: in place over `existing` (overwrite)
/// when no other row shares its blob, otherwise a freshly allocated location.
pub async fn write_location(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    virt_path: &str,
    name: &str,
    existing: Option<&File>,
) -> Result<String> {
    if let Some(ex) = existing {
        if !crate::services::blob_gc::is_referenced(db, owner_id, &ex.storage_path, Some(ex.id)).await? {
            return Ok(ex.storage_path.clone());
        }
    }
    allocate_storage_path(db, storage, owner_id, virt_path, name, None).await
}

/// Moves a row's bytes to `to`. When another row shares them (data written
/// before locations were allocated) they are COPIED instead, so that row keeps
/// its bytes.
async fn relocate_blob(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    file: &File,
    to: &str,
) -> Result<()> {
    if file.storage_path == to {
        return Ok(());
    }
    if crate::services::blob_gc::is_referenced(db, owner_id, &file.storage_path, Some(file.id)).await? {
        storage.copy(&file.storage_path, to).await?;
    } else {
        storage.mv(&file.storage_path, to).await?;
    }
    Ok(())
}

/// Relocates a row's bytes to `to`, then applies `set_sql` to the row (which
/// must point it at `to`). When the database step fails — a name taken by a
/// concurrent write, typically — the bytes go back where the row still says
/// they are, so the row never points at an empty location.
async fn relocate_and_update(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    file: &File,
    to: &str,
    set_sql: &str,
    ps: Vec<DbValue>,
) -> Result<File> {
    let shared = file.storage_path != to
        && crate::services::blob_gc::is_referenced(db, owner_id, &file.storage_path, Some(file.id)).await?;
    relocate_blob(db, storage, owner_id, file, to).await?;
    match update_file_returning(db, owner_id, file.id, set_sql, ps).await {
        Ok(updated) => {
            release_reservation(to);
            Ok(updated)
        }
        Err(e) => {
            if file.storage_path != to {
                let undo = if shared { storage.delete(to).await } else { storage.mv(to, &file.storage_path).await };
                if let Err(u) = undo {
                    tracing::error!(
                        file_id = %file.id, from = %to, to = %file.storage_path, error = %u,
                        "Could not undo a file relocation after a failed update"
                    );
                }
            }
            Err(e)
        }
    }
}

/// Enregistre la ligne fichier après écriture du blob : INSERT, ou MISE À JOUR
/// EN PLACE (id préservé) quand `existing` est fourni (cas overwrite).
///
/// When the insert finds the name taken by a concurrent write (one live file per
/// name and folder), `overwrite` decides: the winner's row is updated in place
/// (last writer wins), or the new file takes a numbered name.
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
    overwrite: bool,
) -> Result<File> {
    let mut name = name.to_string();
    let mut existing = existing;
    for _ in 0..MAX_INSERT_ATTEMPTS {
        if let Some(ex) = existing.take() {
            let delta = size - ex.size_bytes;
            let updated = update_file_returning(
                db,
                owner_id,
                ex.id,
                "name = $1, extension = $2, mime_type = $3, size_bytes = $4, \
                 storage_path = $5, content_hash = $6, metadata = COALESCE($7, metadata)",
                params![&name, extension_of(&name), mime_type, size, storage_path_str, content_hash, metadata],
            )
            .await?;
            release_reservation(storage_path_str);
            if delta != 0 {
                update_used_bytes(db, owner_id, delta).await;
            }
            // The previous blob goes once the row points elsewhere, and only if no
            // other row still uses it.
            if ex.storage_path != storage_path_str {
                crate::services::blob_gc::delete_blob_if_unreferenced(db, storage, owner_id, &ex.storage_path).await?;
            }
            return Ok(updated);
        }

        let meta = metadata.clone().unwrap_or(serde_json::Value::Object(Default::default()));
        let id = kubuno_db::new_id();
        match insert_file(
            db,
            id,
            owner_id,
            folder_id,
            &name,
            extension_of(&name),
            mime_type,
            size,
            storage_path_str,
            content_hash,
            meta,
        )
        .await
        {
            Ok(()) => {
                release_reservation(storage_path_str);
                update_used_bytes(db, owner_id, size).await;
                return get_file(db, owner_id, id).await;
            }
            Err(e) if is_unique_violation(&e) => {
                tracing::warn!(owner_id = %owner_id, name = %name, "File name taken by a concurrent write");
                if overwrite {
                    existing = resolve_for_write(db, owner_id, folder_id, &name, true, false).await?.1;
                } else {
                    name = unique_file_name(&name, &live_names(db, owner_id, folder_id).await?);
                }
            }
            Err(e) => {
                tracing::error!(owner_id = %owner_id, error = %e, "Failed to insert a file row");
                return Err(e);
            }
        }
    }
    Err(FilesError::Conflict(name))
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
    // The server's name rule (kubuno-drive-core, profile `Server`): at most 255 bytes like an uploaded
    // name (sanitize-filename's limit) and every file system's.
    if !kubuno_drive_core::verdict(&name, kubuno_drive_core::Profile::Server).is_accepted() {
        return Err(FilesError::Validation("Nom invalide".into()));
    }
    // Validated before anything is touched (the overwrite branch deletes).
    ensure_plain_name(&name)?;

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
    let new_storage_str = allocate_storage_path(db, storage, owner_id, &virt_path, &name, Some(&file)).await?;
    let extension = std::path::Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());
    let mime = MimeGuess::from_path(&name).first_or_octet_stream().to_string();

    relocate_and_update(
        db,
        storage,
        owner_id,
        &file,
        &new_storage_str,
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
    let new_storage_str =
        allocate_storage_path(db, storage, owner_id, &new_virt_path, &safe_name, Some(&file)).await?;
    relocate_and_update(
        db,
        storage,
        owner_id,
        &file,
        &new_storage_str,
        "folder_id = $1, name = $2, storage_path = $3",
        params![dto.folder_id, &safe_name, &new_storage_str],
    )
    .await
}

/// Moves a TRASHED file into `folder_id`, keeping it in the trash.
///
/// Unlike [`move_file`], the new name is made unique among ALL the destination's
/// files, trashed ones included: two rows with the same name in one folder share
/// one storage path, and the move would overwrite the other file's bytes.
pub async fn move_trashed_file(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    file: &File,
    folder_id: Option<Uuid>,
) -> Result<File> {
    let sql = format!(
        "SELECT name FROM drive.files WHERE owner_id = $1 AND {} AND id <> $3",
        null_safe_eq(db.backend(), "folder_id", 2)
    );
    let taken: Vec<String> = db
        .fetch_all_as::<NameOnly>(&sql, params![owner_id, folder_id, file.id])
        .await
        .inspect_err(|e| tracing::error!(file_id = %file.id, error = %e, "Failed to list the destination names"))?
        .into_iter()
        .map(|r| r.name)
        .collect();
    let name = unique_file_name(&file.name, &taken);

    let virt_path = folder_virt_path(db, folder_id, owner_id).await?;
    let new_storage = allocate_storage_path(db, storage, owner_id, &virt_path, &name, Some(file)).await?;
    relocate_and_update(
        db,
        storage,
        owner_id,
        file,
        &new_storage,
        "folder_id = $1, name = $2, storage_path = $3",
        params![folder_id, &name, &new_storage],
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

/// Takes a file out of the trash. When a live file of its folder now carries the
/// same name, the restored one gets a unique name (`a (2).txt`) — and a location
/// of its own — rather than two visible files sharing one name.
pub async fn restore_file(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    file_id: Uuid,
) -> Result<File> {
    let file = get_file(db, owner_id, file_id).await?;
    if file.is_trashed {
        let sql = format!(
            "SELECT name FROM drive.files WHERE owner_id = $1 AND {} AND id <> $3 AND is_trashed = FALSE",
            null_safe_eq(db.backend(), "folder_id", 2)
        );
        let live_names: Vec<String> = db
            .fetch_all_as::<NameOnly>(&sql, params![owner_id, file.folder_id, file_id])
            .await
            .inspect_err(|e| tracing::error!(file_id = %file_id, error = %e, "Failed to list the names a restore could clash with"))?
            .into_iter()
            .map(|r| r.name)
            .collect();
        if live_names.iter().any(|n| n == &file.name) {
            let name = unique_file_name(&file.name, &live_names);
            let virt_path = folder_virt_path(db, file.folder_id, owner_id).await?;
            let location = allocate_storage_path(db, storage, owner_id, &virt_path, &name, Some(&file)).await?;
            let extension = std::path::Path::new(&name)
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase());
            return relocate_and_update(
                db,
                storage,
                owner_id,
                &file,
                &location,
                "name = $1, extension = $2, storage_path = $3, is_trashed = $4, trashed_at = $5",
                params![&name, extension, &location, false, None::<chrono::DateTime<chrono::Utc>>],
            )
            .await;
        }
    }
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

    // The version history goes in the same transaction as the file, so the row,
    // its revisions and the quota move together (the FK cascade alone would drop
    // the revision rows and leak both their blobs and their charge).
    let versions: Vec<StoredBlob> = db
        .fetch_all_as::<StoredBlob>(
            "SELECT storage_path, size_bytes FROM drive.file_versions WHERE owner_id = $1 AND file_id = $2",
            params![owner_id, file_id],
        )
        .await
        .inspect_err(|e| tracing::error!(file_id = %file_id, error = %e, "Failed to list the file versions"))?;

    // Hard delete plus a tombstone, in one transaction, stamped with a fresh seq
    // so an offline client learns the file is gone (the old AFTER DELETE trigger).
    let mut tx = db.begin().await?;
    let seq = sync::next_seq(&mut tx).await?;
    tx.execute(
        "DELETE FROM drive.file_versions WHERE owner_id = $1 AND file_id = $2",
        params![owner_id, file_id],
    )
    .await
    .inspect_err(|e| tracing::error!(file_id = %file_id, error = %e, "Failed to delete the file versions"))?;
    tx.execute(
        "DELETE FROM drive.files WHERE id = $1 AND owner_id = $2",
        params![file_id, owner_id],
    )
    .await
    .inspect_err(|e| tracing::error!(file_id = %file_id, error = %e, "Échec de suppression du fichier"))?;
    sync::record_file_tombstone(&mut tx, file_id, owner_id, &file.name, seq).await?;
    tx.commit()
        .await
        .inspect_err(|e| tracing::error!(file_id = %file_id, error = %e, "Failed to commit the file deletion"))?;

    // Charged once: the file and every revision it had.
    let freed = file.size_bytes + versions.iter().map(|v| v.size_bytes).sum::<i64>();
    update_used_bytes(db, owner_id, -freed).await;

    // Bytes only once the rows are gone, and only if no live row shares them.
    crate::services::blob_gc::delete_blob_if_unreferenced(db, storage, owner_id, &file.storage_path).await?;
    for v in &versions {
        crate::services::blob_gc::delete_blob_if_unreferenced(db, storage, owner_id, &v.storage_path).await?;
    }
    let thumb = storage_path::user_thumbnail_path(owner_id, file_id);
    if let Err(e) = storage.delete(&thumb.to_string_lossy()).await {
        tracing::warn!(error = %e, "Could not delete thumbnail");
    }

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
    let dest_str = write_location(db, storage, owner_id, &virt_path, &safe_name, existing.as_ref()).await?;
    let size = data.len() as i64;

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let hash = hex::encode(hasher.finalize());

    storage.put(&dest_str, data).await?;

    insert_or_update_record(
        db, storage, owner_id, folder_id, &safe_name, mime_type, size, &dest_str, Some(&hash), metadata, existing,
        overwrite,
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
    let new_storage_str = allocate_storage_path(db, storage, owner_id, &virt_path, &new_name, None).await?;

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
    let dest_str = write_location(db, storage, owner_id, &virt_path, &safe_name, existing.as_ref()).await?;

    storage.put(&dest_str, data).await?;

    insert_or_update_record(
        db, storage, owner_id, folder_id, &safe_name, &mime, size, &dest_str, Some(&hash), None, existing,
        overwrite,
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
