use bytes::Bytes;
use kubuno_storage::{StorageBackend, path as storage_path};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    models::{File, FileVersion, Folder},
    services::files::get_file,
};

// ── Lecture ───────────────────────────────────────────────────────────────────

pub async fn list_versions(db: &PgPool, owner_id: Uuid, file_id: Uuid) -> Result<Vec<FileVersion>> {
    get_file(db, owner_id, file_id).await?;

    let versions = sqlx::query_as::<_, FileVersion>(
        "SELECT * FROM drive.file_versions WHERE file_id = $1 ORDER BY version_number DESC"
    )
    .bind(file_id)
    .fetch_all(db)
    .await?;

    Ok(versions)
}

pub async fn get_version(
    db: &PgPool,
    owner_id: Uuid,
    file_id: Uuid,
    version_id: Uuid,
) -> Result<FileVersion> {
    get_file(db, owner_id, file_id).await?;

    sqlx::query_as::<_, FileVersion>(
        "SELECT * FROM drive.file_versions WHERE id = $1 AND file_id = $2"
    )
    .bind(version_id)
    .bind(file_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| FilesError::NotFound(format!("Version {version_id} introuvable")))
}

// ── Création ──────────────────────────────────────────────────────────────────

/// Crée un snapshot de la version actuelle du fichier.
pub async fn create_version(
    db: &PgPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    file_id: Uuid,
    comment: Option<String>,
) -> Result<FileVersion> {
    let file = get_file(db, owner_id, file_id).await?;

    // Numéro de version suivant
    let next_num: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(version_number), 0) + 1 FROM drive.file_versions WHERE file_id = $1"
    )
    .bind(file_id)
    .fetch_one(db)
    .await?;

    // Copier le fichier courant vers le chemin de version
    let version_path = storage_path::user_version_path(owner_id, file_id, next_num, &file.name);
    let version_path_str = version_path.to_string_lossy().to_string();

    let data = storage.get(&file.storage_path).await?;
    storage.put(&version_path_str, Bytes::from(data.to_vec())).await?;

    let version = sqlx::query_as::<_, FileVersion>(
        "INSERT INTO drive.file_versions
            (file_id, owner_id, version_number, storage_path, size_bytes, content_hash, comment)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *"
    )
    .bind(file_id)
    .bind(owner_id)
    .bind(next_num)
    .bind(&version_path_str)
    .bind(file.size_bytes)
    .bind(&file.content_hash)
    .bind(comment)
    .fetch_one(db)
    .await?;

    // Retention: keep at most MAX_VERSIONS, pruning the oldest beyond the limit.
    const MAX_VERSIONS: i64 = 50;
    let stale: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT id, storage_path FROM drive.file_versions
         WHERE file_id = $1 ORDER BY version_number DESC OFFSET $2",
    )
    .bind(file_id)
    .bind(MAX_VERSIONS)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    for (vid, path) in stale {
        let _ = storage.delete(&path).await;
        let _ = sqlx::query("DELETE FROM drive.file_versions WHERE id = $1")
            .bind(vid)
            .execute(db)
            .await;
    }

    Ok(version)
}

// ── Restauration ─────────────────────────────────────────────────────────────

/// Restaure une version précédente en l'écrivant comme fichier courant.
/// Crée d'abord une version de l'état actuel pour ne rien perdre.
pub async fn restore_version(
    db: &PgPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    file_id: Uuid,
    version_id: Uuid,
) -> Result<File> {
    let file    = get_file(db, owner_id, file_id).await?;
    let version = get_version(db, owner_id, file_id, version_id).await?;

    // Sauvegarder l'état actuel avant de restaurer
    create_version(db, storage, owner_id, file_id, Some("Avant restauration".into())).await?;

    // Charger la version et l'écrire à l'emplacement courant
    let data = storage.get(&version.storage_path).await?;
    let size = data.len() as i64;
    storage.put(&file.storage_path, Bytes::from(data.to_vec())).await?;

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let hash = hex::encode(hasher.finalize());

    let updated = sqlx::query_as::<_, File>(
        "UPDATE drive.files
         SET size_bytes = $1, content_hash = $2
         WHERE id = $3 RETURNING *"
    )
    .bind(size)
    .bind(&hash)
    .bind(file_id)
    .fetch_one(db)
    .await?;

    Ok(updated)
}

// ── Suppression ───────────────────────────────────────────────────────────────

pub async fn delete_version(
    db: &PgPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    file_id: Uuid,
    version_id: Uuid,
) -> Result<()> {
    let version = get_version(db, owner_id, file_id, version_id).await?;

    if let Err(e) = storage.delete(&version.storage_path).await {
        tracing::warn!(path = %version.storage_path, error = %e, "Impossible de supprimer le fichier de version");
    }

    sqlx::query("DELETE FROM drive.file_versions WHERE id = $1")
        .bind(version_id)
        .execute(db)
        .await?;

    Ok(())
}

// ── Activation ────────────────────────────────────────────────────────────────

pub async fn set_file_versioning(
    db: &PgPool,
    owner_id: Uuid,
    file_id: Uuid,
    enabled: bool,
) -> Result<File> {
    let file = sqlx::query_as::<_, File>(
        "UPDATE drive.files SET versioning_enabled = $1
         WHERE id = $2 AND owner_id = $3 RETURNING *"
    )
    .bind(enabled)
    .bind(file_id)
    .bind(owner_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| FilesError::NotFound(format!("Fichier {file_id} introuvable")))?;

    Ok(file)
}

pub async fn set_folder_versioning(
    db: &PgPool,
    owner_id: Uuid,
    folder_id: Uuid,
    enabled: bool,
) -> Result<Folder> {
    let folder = sqlx::query_as::<_, Folder>(
        "UPDATE drive.folders SET versioning_enabled = $1
         WHERE id = $2 AND owner_id = $3 RETURNING *"
    )
    .bind(enabled)
    .bind(folder_id)
    .bind(owner_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| FilesError::NotFound(format!("Dossier {folder_id} introuvable")))?;

    Ok(folder)
}

// ── Vérification d'héritage ───────────────────────────────────────────────────

/// Renvoie vrai si le versionnage est actif pour ce fichier (directement ou via son dossier).
pub async fn is_versioning_active(db: &PgPool, owner_id: Uuid, file_id: Uuid) -> Result<bool> {
    let row: Option<(bool, Option<Uuid>)> = sqlx::query_as(
        "SELECT versioning_enabled, folder_id FROM drive.files WHERE id = $1 AND owner_id = $2"
    )
    .bind(file_id)
    .bind(owner_id)
    .fetch_optional(db)
    .await?;

    let (file_versioning, folder_id) = match row {
        None    => return Ok(false),
        Some(r) => r,
    };

    if file_versioning {
        return Ok(true);
    }

    // Vérifier les dossiers ancêtres
    if let Some(fid) = folder_id {
        let folder_versioning: Option<bool> = sqlx::query_scalar(
            "WITH RECURSIVE ancestors AS (
                SELECT id, parent_id, versioning_enabled
                FROM drive.folders WHERE id = $1 AND owner_id = $2
                UNION ALL
                SELECT f.id, f.parent_id, f.versioning_enabled
                FROM drive.folders f
                JOIN ancestors a ON f.id = a.parent_id
                WHERE f.owner_id = $2
             )
             SELECT bool_or(versioning_enabled) FROM ancestors"
        )
        .bind(fid)
        .bind(owner_id)
        .fetch_optional(db)
        .await?
        .flatten();

        return Ok(folder_versioning.unwrap_or(false));
    }

    Ok(false)
}
