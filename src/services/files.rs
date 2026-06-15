use bytes::Bytes;
use kubuno_storage::{StorageBackend, path as storage_path, unique_file_name};
use mime_guess::MimeGuess;
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    models::{File, ListFilesQuery, MoveFileDto, RenameFileDto},
};

// ── Helpers internes ──────────────────────────────────────────────────────────

/// Résout le nom final d'un fichier selon la politique d'écrasement :
/// - `overwrite=true`  : supprime le fichier existant portant ce nom (non corbeille), retourne le nom tel quel
/// - `overwrite=false` : ajoute " (2)", " (3)"… si conflit (ne détruit rien)
/// Résout le nom définitif d'un fichier selon la politique de conflit choisie.
///
/// - `overwrite=true` : supprime le fichier existant et retourne le nom tel quel.
/// - `overwrite=false, strict=false` : renomme automatiquement avec numérotation (défaut).
/// - `overwrite=false, strict=true` : retourne HTTP 409 si un conflit existe, sans modifier quoi que ce soit.
///   Utilisé pour les opérations initiées par l'utilisateur dans les dossiers partagés où le cache client
///   peut être périmé.
pub async fn resolve_name(
    db:        &PgPool,
    storage:   &Arc<dyn StorageBackend>,
    owner_id:  Uuid,
    folder_id: Option<Uuid>,
    name:      &str,
    overwrite: bool,
    strict:    bool,
) -> Result<String> {
    if overwrite {
        let existing: Option<File> = sqlx::query_as::<_, File>(
            "SELECT * FROM drive.files
             WHERE owner_id = $1 AND folder_id IS NOT DISTINCT FROM $2 AND name = $3 AND is_trashed = FALSE"
        )
        .bind(owner_id)
        .bind(folder_id)
        .bind(name)
        .fetch_optional(db)
        .await?;

        if let Some(f) = existing {
            delete_file_permanently(db, storage, owner_id, f.id).await?;
        }
        Ok(name.to_string())
    } else {
        let existing_names: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM drive.files
             WHERE owner_id = $1 AND folder_id IS NOT DISTINCT FROM $2 AND is_trashed = FALSE"
        )
        .bind(owner_id)
        .bind(folder_id)
        .fetch_all(db)
        .await?;

        if strict && existing_names.iter().any(|n| n == name) {
            return Err(FilesError::Conflict(name.to_string()));
        }
        Ok(unique_file_name(name, &existing_names))
    }
}

/// Met à jour le quota consommé de l'utilisateur (delta positif = ajout, négatif = libération).
pub async fn update_used_bytes(db: &PgPool, owner_id: Uuid, delta: i64) {
    if let Err(e) = sqlx::query(
        "UPDATE core.users SET used_bytes = GREATEST(0, used_bytes + $1) WHERE id = $2"
    )
    .bind(delta)
    .bind(owner_id)
    .execute(db)
    .await
    {
        tracing::error!(owner_id = %owner_id, delta, error = %e, "Échec mise à jour used_bytes");
    }
}

/// Récupère le chemin virtuel d'un dossier (vide = racine).
pub async fn folder_virt_path(db: &PgPool, folder_id: Option<Uuid>, owner_id: Uuid) -> Result<String> {
    match folder_id {
        None => Ok(String::new()),
        Some(fid) => sqlx::query_scalar::<_, String>(
            "SELECT path FROM drive.folders WHERE id = $1 AND owner_id = $2"
        )
        .bind(fid)
        .bind(owner_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| FilesError::NotFound("Dossier cible introuvable".into())),
    }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

pub async fn create_file_record(
    db: &PgPool,
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

    let file = sqlx::query_as::<_, File>(
        "INSERT INTO drive.files
            (owner_id, folder_id, name, extension, mime_type, size_bytes, storage_path, content_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *"
    )
    .bind(owner_id)
    .bind(folder_id)
    .bind(name)
    .bind(extension)
    .bind(mime_type)
    .bind(size_bytes)
    .bind(storage_path_str)
    .bind(content_hash)
    .fetch_one(db)
    .await?;

    update_used_bytes(db, owner_id, size_bytes).await;

    Ok(file)
}

pub async fn list_files(
    db: &PgPool,
    owner_id: Uuid,
    query: ListFilesQuery,
) -> Result<Vec<File>> {
    let limit = query.limit.unwrap_or(100).min(1000);
    let offset = query.offset.unwrap_or(0);

    let trashed = query.trashed.unwrap_or(false);
    let is_recent = query.recent.unwrap_or(false);

    let mut q = String::from(
        "SELECT ff.* FROM drive.files ff WHERE ff.owner_id = $1 AND ff.is_trashed = $2"
    );
    let mut param_idx = 3usize;

    if query.folder_id.is_some() {
        q.push_str(&format!(" AND ff.folder_id = ${param_idx}"));
        param_idx += 1;
    } else if query.folder_path_prefix.is_some() {
        // Filter by all files whose folder path starts with the given prefix
        q.push_str(&format!(
            " AND ff.folder_id IN (SELECT id FROM drive.folders WHERE owner_id = $1 AND path LIKE ${param_idx})"
        ));
        param_idx += 1;
    } else if !is_recent && query.trashed.is_none() && query.starred.is_none() {
        q.push_str(" AND ff.folder_id IS NULL");
    }

    if query.starred.is_some() {
        q.push_str(&format!(" AND ff.is_starred = ${param_idx}"));
        param_idx += 1;
    }

    if query.mime_type.is_some() {
        q.push_str(&format!(" AND ff.mime_type ILIKE ${param_idx}"));
        param_idx += 1;
    }

    if query.search.is_some() {
        q.push_str(&format!(" AND ff.name ILIKE ${param_idx}"));
        param_idx += 1;
    }

    let order = match query.sort_by.as_deref() {
        Some("size")    => "ff.size_bytes",
        Some("name")    => "ff.name",
        Some("updated") => "ff.updated_at",
        _ if is_recent  => "ff.updated_at",
        _               => "ff.created_at",
    };
    let order_dir = if query.sort_by.as_deref() == Some("name") { "ASC" } else { "DESC" };
    q.push_str(&format!(" ORDER BY {order} {order_dir} LIMIT ${param_idx} OFFSET ${}", param_idx + 1));

    let mut builder = sqlx::query_as::<_, File>(&q)
        .bind(owner_id)
        .bind(trashed);

    if let Some(fid)    = query.folder_id          { builder = builder.bind(fid); }
    else if let Some(p) = query.folder_path_prefix { builder = builder.bind(format!("{p}%")); }
    if let Some(s)      = query.starred            { builder = builder.bind(s); }
    if let Some(mt)     = query.mime_type          { builder = builder.bind(format!("{mt}%")); }
    if let Some(s)      = query.search             { builder = builder.bind(format!("%{s}%")); }

    let files = builder.bind(limit).bind(offset).fetch_all(db).await?;
    Ok(files)
}

pub async fn get_file(db: &PgPool, owner_id: Uuid, file_id: Uuid) -> Result<File> {
    sqlx::query_as::<_, File>(
        "SELECT * FROM drive.files WHERE id = $1 AND owner_id = $2"
    )
    .bind(file_id)
    .bind(owner_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| FilesError::NotFound(format!("Fichier {file_id} introuvable")))
}

pub async fn get_file_any_owner(db: &PgPool, file_id: Uuid) -> Result<File> {
    sqlx::query_as::<_, File>(
        "SELECT * FROM drive.files WHERE id = $1"
    )
    .bind(file_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| FilesError::NotFound(format!("Fichier {file_id} introuvable")))
}

pub async fn rename_file(
    db: &PgPool,
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

    // Résoudre le nom final (overwrite / auto-rename / strict 409)
    // On exclut le fichier lui-même pour ne pas se bloquer sur son propre nom
    let folder_id_for_resolve = file.folder_id;
    let existing_excl_self: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM drive.files WHERE owner_id = $1 AND folder_id IS NOT DISTINCT FROM $2 AND id != $3 AND is_trashed = FALSE"
    )
    .bind(owner_id)
    .bind(folder_id_for_resolve)
    .bind(file_id)
    .fetch_all(db)
    .await?;

    let name = if dto.overwrite {
        // Supprimer l'éventuel fichier existant (pas soi-même)
        if let Some(existing) = sqlx::query_as::<_, File>(
            "SELECT * FROM drive.files WHERE owner_id = $1 AND folder_id IS NOT DISTINCT FROM $2 AND name = $3 AND id != $4 AND is_trashed = FALSE"
        )
        .bind(owner_id).bind(folder_id_for_resolve).bind(&name).bind(file_id)
        .fetch_optional(db).await? {
            delete_file_permanently(db, storage, owner_id, existing.id).await?;
        }
        name
    } else if dto.strict && existing_excl_self.iter().any(|n| n == &name) {
        return Err(FilesError::Conflict(name));
    } else {
        unique_file_name(&name, &existing_excl_self)
    };

    // Calculer le nouveau chemin storage (même dossier, nouveau nom)
    let virt_path = folder_virt_path(db, file.folder_id, owner_id).await?;
    let new_storage = storage_path::user_file_path(owner_id, &virt_path, &name);
    let new_storage_str = new_storage.to_string_lossy().to_string();

    // Déplacer le fichier physique
    storage.mv(&file.storage_path, &new_storage_str).await?;

    let extension = std::path::Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());
    let mime = MimeGuess::from_path(&name).first_or_octet_stream().to_string();

    sqlx::query_as::<_, File>(
        "UPDATE drive.files
         SET name = $1, extension = $2, mime_type = $3, storage_path = $4
         WHERE id = $5 AND owner_id = $6 RETURNING *"
    )
    .bind(&name)
    .bind(extension)
    .bind(mime)
    .bind(&new_storage_str)
    .bind(file_id)
    .bind(owner_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| FilesError::NotFound(format!("Fichier {file_id} introuvable")))
}

pub async fn move_file(
    db: &PgPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    file_id: Uuid,
    dto: MoveFileDto,
) -> Result<File> {
    let file = get_file(db, owner_id, file_id).await?;

    let safe_name = resolve_name(db, storage, owner_id, dto.folder_id, &file.name, dto.overwrite, dto.strict).await?;

    // Chemin virtuel du dossier de destination
    let new_virt_path = folder_virt_path(db, dto.folder_id, owner_id).await?;
    let new_storage = storage_path::user_file_path(owner_id, &new_virt_path, &safe_name);
    let new_storage_str = new_storage.to_string_lossy().to_string();

    // Déplacer le fichier physique
    storage.mv(&file.storage_path, &new_storage_str).await?;

    sqlx::query_as::<_, File>(
        "UPDATE drive.files SET folder_id = $1, name = $2, storage_path = $3
         WHERE id = $4 AND owner_id = $5 RETURNING *"
    )
    .bind(dto.folder_id)
    .bind(&safe_name)
    .bind(&new_storage_str)
    .bind(file_id)
    .bind(owner_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| FilesError::NotFound(format!("Fichier {file_id} introuvable")))
}

pub async fn trash_file(db: &PgPool, owner_id: Uuid, file_id: Uuid) -> Result<File> {
    let existing = get_file(db, owner_id, file_id).await?;
    if existing.is_protected {
        return Err(FilesError::Protected(file_protected_msg(&existing.name)));
    }
    sqlx::query_as::<_, File>(
        "UPDATE drive.files SET is_trashed = TRUE, trashed_at = NOW()
         WHERE id = $1 AND owner_id = $2 RETURNING *"
    )
    .bind(file_id)
    .bind(owner_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| FilesError::NotFound(format!("Fichier {file_id} introuvable")))
}

fn file_protected_msg(name: &str) -> String {
    format!("Le fichier « {name} » est protégé par une application (par exemple une exécution Flow en cours) et ne peut pas être supprimé pour le moment.")
}

// Active/désactive la protection d'un fichier (appelé par les modules via IPC).
pub async fn set_protected(db: &PgPool, owner_id: Uuid, file_id: Uuid, protected: bool) -> Result<File> {
    sqlx::query_as::<_, File>(
        "UPDATE drive.files SET is_protected = $3 WHERE id = $1 AND owner_id = $2 RETURNING *",
    )
    .bind(file_id)
    .bind(owner_id)
    .bind(protected)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| FilesError::NotFound(format!("Fichier {file_id} introuvable")))
}

pub async fn restore_file(db: &PgPool, owner_id: Uuid, file_id: Uuid) -> Result<File> {
    sqlx::query_as::<_, File>(
        "UPDATE drive.files SET is_trashed = FALSE, trashed_at = NULL
         WHERE id = $1 AND owner_id = $2 RETURNING *"
    )
    .bind(file_id)
    .bind(owner_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| FilesError::NotFound(format!("Fichier {file_id} introuvable")))
}

pub async fn delete_file_permanently(
    db: &PgPool,
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

    sqlx::query("DELETE FROM drive.files WHERE id = $1 AND owner_id = $2")
        .bind(file_id)
        .bind(owner_id)
        .execute(db)
        .await?;

    update_used_bytes(db, owner_id, -file.size_bytes).await;

    Ok(())
}

pub async fn toggle_star_file(
    db: &PgPool,
    owner_id: Uuid,
    file_id: Uuid,
) -> Result<File> {
    sqlx::query_as::<_, File>(
        "UPDATE drive.files SET is_starred = NOT is_starred
         WHERE id = $1 AND owner_id = $2 RETURNING *"
    )
    .bind(file_id)
    .bind(owner_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| FilesError::NotFound(format!("Fichier {file_id} introuvable")))
}

/// Met à jour la clé `open_with` dans le JSON `metadata` d'un fichier.
/// `module_id = None` supprime la préférence (retour au comportement par défaut).
pub async fn set_open_with(
    db:        &PgPool,
    owner_id:  Uuid,
    file_id:   Uuid,
    module_id: Option<&str>,
) -> Result<File> {
    sqlx::query_as::<_, File>(
        "UPDATE drive.files
         SET metadata = CASE
             WHEN $1::text IS NULL THEN metadata - 'open_with'
             ELSE jsonb_set(metadata, '{open_with}', to_jsonb($1::text))
         END
         WHERE id = $2 AND owner_id = $3 RETURNING *",
    )
    .bind(module_id)
    .bind(file_id)
    .bind(owner_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| FilesError::NotFound(format!("Fichier {file_id} introuvable")))
}

/// Met à jour les métadonnées utilisateur d'un fichier (titre, description, auteur, mots-clés).
/// Seuls les champs fournis sont écrasés ; les champs absents sont conservés.
pub async fn update_user_metadata(
    db:       &PgPool,
    owner_id: Uuid,
    file_id:  Uuid,
    patch:    serde_json::Value,
) -> Result<File> {
    sqlx::query_as::<_, File>(
        "UPDATE drive.files
         SET metadata = metadata || $1::jsonb
         WHERE id = $2 AND owner_id = $3 RETURNING *",
    )
    .bind(patch)
    .bind(file_id)
    .bind(owner_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| FilesError::NotFound(format!("Fichier {file_id} introuvable")))
}

/// Créer un fichier en écrivant les bytes en storage + enregistrement DB en une seule opération.
/// Utilisé par les modules qui génèrent du contenu (Office, PaintSharp…).
pub async fn create_with_bytes(
    db:        &PgPool,
    storage:   &Arc<dyn StorageBackend>,
    owner_id:  Uuid,
    folder_id: Option<Uuid>,
    name:      &str,
    mime_type: &str,
    data:      Bytes,
    metadata:  Option<serde_json::Value>,
    overwrite: bool,
) -> Result<File> {
    let safe_name = resolve_name(db, storage, owner_id, folder_id, name, overwrite, false).await?;

    let virt_path = folder_virt_path(db, folder_id, owner_id).await?;
    let dest      = storage_path::user_file_path(owner_id, &virt_path, &safe_name);
    let dest_str  = dest.to_string_lossy().to_string();
    let size      = data.len() as i64;

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let hash = hex::encode(hasher.finalize());

    storage.put(&dest_str, data).await?;

    let extension = std::path::Path::new(&safe_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());

    let meta = metadata.unwrap_or(serde_json::Value::Object(Default::default()));

    let file = sqlx::query_as::<_, File>(
        "INSERT INTO drive.files
            (owner_id, folder_id, name, extension, mime_type, size_bytes, storage_path, content_hash, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *"
    )
    .bind(owner_id)
    .bind(folder_id)
    .bind(&safe_name)
    .bind(extension)
    .bind(mime_type)
    .bind(size)
    .bind(&dest_str)
    .bind(&hash)
    .bind(&meta)
    .fetch_one(db)
    .await?;

    update_used_bytes(db, owner_id, size).await;

    Ok(file)
}

/// Remplace le contenu d'un fichier existant (même chemin storage, taille/hash mis à jour).
pub async fn update_content_bytes(
    db:       &PgPool,
    storage:  &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    file_id:  Uuid,
    data:     Bytes,
) -> Result<File> {
    let file     = get_file(db, owner_id, file_id).await?;
    let old_size = file.size_bytes;
    let new_size = data.len() as i64;

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let hash = hex::encode(hasher.finalize());

    storage.put(&file.storage_path, data).await?;

    let updated = sqlx::query_as::<_, File>(
        "UPDATE drive.files SET size_bytes = $1, content_hash = $2
         WHERE id = $3 AND owner_id = $4 RETURNING *"
    )
    .bind(new_size)
    .bind(&hash)
    .bind(file_id)
    .bind(owner_id)
    .fetch_one(db)
    .await?;

    update_used_bytes(db, owner_id, new_size - old_size).await;

    Ok(updated)
}

/// Copier un fichier dans un dossier destination (en conservant l'original).
pub async fn copy_file(
    db:        &PgPool,
    storage:   &Arc<dyn StorageBackend>,
    owner_id:  Uuid,
    file_id:   Uuid,
    folder_id: Option<Uuid>,
) -> Result<File> {
    let src = get_file(db, owner_id, file_id).await?;

    // Générer un nom unique dans le dossier destination
    let existing: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM drive.files WHERE owner_id = $1 AND folder_id IS NOT DISTINCT FROM $2 AND is_trashed = FALSE",
    )
    .bind(owner_id)
    .bind(folder_id)
    .fetch_all(db)
    .await?;

    let new_name    = unique_file_name(&src.name, &existing);
    let virt_path   = folder_virt_path(db, folder_id, owner_id).await?;
    let new_storage = storage_path::user_file_path(owner_id, &virt_path, &new_name);
    let new_storage_str = new_storage.to_string_lossy().to_string();

    storage.copy(&src.storage_path, &new_storage_str).await?;

    let file = create_file_record(
        db, owner_id, folder_id, &new_name, &src.mime_type,
        src.size_bytes, &new_storage_str, src.content_hash.as_deref(),
    ).await?;

    Ok(file)
}

/// Upload simple (fichier entier en une requête multipart).
pub async fn upload_simple(
    db: &PgPool,
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

    let safe_name = resolve_name(db, storage, owner_id, folder_id, &sanitized, overwrite, false).await?;

    let mime = MimeGuess::from_path(&safe_name).first_or_octet_stream().to_string();

    let file_id = Uuid::new_v4();
    let size    = data.len() as i64;

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let hash = hex::encode(hasher.finalize());

    // Chemin style Nextcloud
    let virt_path = folder_virt_path(db, folder_id, owner_id).await?;
    let dest = storage_path::user_file_path(owner_id, &virt_path, &safe_name);
    let dest_str = dest.to_string_lossy().to_string();

    storage.put(&dest_str, data).await?;

    let extension = std::path::Path::new(&safe_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());

    let file = sqlx::query_as::<_, File>(
        "INSERT INTO drive.files
            (id, owner_id, folder_id, name, extension, mime_type, size_bytes, storage_path, content_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *"
    )
    .bind(file_id)
    .bind(owner_id)
    .bind(folder_id)
    .bind(&safe_name)
    .bind(extension)
    .bind(&mime)
    .bind(size)
    .bind(&dest_str)
    .bind(&hash)
    .fetch_one(db)
    .await?;

    update_used_bytes(db, owner_id, size).await;

    Ok(file)
}

/// Noms de plusieurs fichiers en un appel (pour les listes des apps) → { id: name }.
pub async fn file_names(
    db: &PgPool,
    owner_id: uuid::Uuid,
    ids: &[uuid::Uuid],
) -> Result<std::collections::HashMap<uuid::Uuid, String>> {
    if ids.is_empty() { return Ok(std::collections::HashMap::new()); }
    let rows: Vec<(uuid::Uuid, String)> = sqlx::query_as(
        "SELECT id, name FROM drive.files WHERE owner_id = $1 AND id = ANY($2)",
    )
    .bind(owner_id).bind(ids)
    .fetch_all(db).await?;
    Ok(rows.into_iter().collect())
}
