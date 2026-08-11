use bytes::Bytes;
use kubuno_storage::{StorageBackend, path as storage_path};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    models::{File, FileVersion, Folder, VersionsPurgeResult, VersionsSummary},
    services::files::{get_file, update_used_bytes},
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

    // A revision is a full copy of the blob, so it costs the account exactly the
    // size of the file it froze. It is charged because the account can now see
    // it and give it back (`DELETE /:id/versions`, `PATCH /:id/versioning`).
    update_used_bytes(db, owner_id, file.size_bytes).await;

    // Retention: keep at most MAX_VERSIONS, pruning the oldest beyond the limit.
    const MAX_VERSIONS: i64 = 50;
    let stale: Vec<(Uuid, String, i64)> = sqlx::query_as(
        "SELECT id, storage_path, size_bytes FROM drive.file_versions
         WHERE file_id = $1 ORDER BY version_number DESC OFFSET $2",
    )
    .bind(file_id)
    .bind(MAX_VERSIONS)
    .fetch_all(db)
    .await
    .inspect_err(|e| tracing::error!(file_id = %file_id, error = %e, "Échec de lecture des versions à élaguer"))
    .unwrap_or_default();
    let mut pruned = 0i64;
    for (vid, path, size) in stale {
        if let Err(e) = storage.delete(&path).await {
            tracing::warn!(path = %path, error = %e, "Impossible de supprimer le blob d'une version élaguée");
        }
        match sqlx::query("DELETE FROM drive.file_versions WHERE id = $1")
            .bind(vid)
            .execute(db)
            .await
        {
            Ok(_)  => pruned += size,
            Err(e) => tracing::error!(version_id = %vid, error = %e, "Échec de suppression d'une version élaguée"),
        }
    }
    if pruned > 0 {
        update_used_bytes(db, owner_id, -pruned).await;
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

    sqlx::query(
        "UPDATE drive.files
         SET size_bytes = $1, content_hash = $2
         WHERE id = $3"
    )
    .bind(size)
    .bind(&hash)
    .bind(file_id)
    .execute(db)
    .await
    .inspect_err(|e| tracing::error!(file_id = %file_id, error = %e, "Échec d'écriture de la version restaurée"))?;

    update_used_bytes(db, owner_id, size - file.size_bytes).await;

    // Re-read rather than `RETURNING *`: the caller gets the file with its
    // version counters, which the restore has just changed.
    get_file(db, owner_id, file_id).await
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
        .await
        .inspect_err(|e| tracing::error!(version_id = %version_id, error = %e, "Échec de suppression d'une version"))?;

    update_used_bytes(db, owner_id, -version.size_bytes).await;

    Ok(())
}

/// Deletes a file's **whole** history, keeping the current content.
///
/// The single statement below both selects and removes, so a revision created
/// while the purge runs is either fully included or untouched — never a row
/// deleted whose blob survives, nor the reverse.
///
/// The freed bytes are handed back to the quota through
/// [`update_used_bytes`]: without it the account would perform the one gesture
/// the interface offers it and watch its gauge stay exactly where it was.
pub async fn purge_versions(
    db: &PgPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    file_id: Uuid,
) -> Result<VersionsPurgeResult> {
    // Ownership check — also turns an unknown id into a 404.
    get_file(db, owner_id, file_id).await?;

    let removed: Vec<(String, i64)> = sqlx::query_as(
        "DELETE FROM drive.file_versions WHERE file_id = $1
         RETURNING storage_path, size_bytes",
    )
    .bind(file_id)
    .fetch_all(db)
    .await
    .inspect_err(|e| tracing::error!(file_id = %file_id, error = %e, "Échec de purge de l'historique"))?;

    if removed.is_empty() {
        return Ok(VersionsPurgeResult { removed: 0, freed_bytes: 0 });
    }

    let mut freed = 0i64;
    for (path, size) in &removed {
        // A blob whose delete fails is still counted as freed: its row is gone,
        // so nothing will ever charge for it again, and the periodic full
        // recount reconciles the disk. Leaving it charged would be a debt the
        // account has no way to settle.
        if let Err(e) = storage.delete(path).await {
            tracing::warn!(path = %path, error = %e, "Impossible de supprimer le blob d'une version purgée");
        }
        freed += *size;
    }

    update_used_bytes(db, owner_id, -freed).await;

    Ok(VersionsPurgeResult { removed: removed.len() as i64, freed_bytes: freed })
}

/// What every version history of the account weighs, all files together.
pub async fn versions_summary(db: &PgPool, owner_id: Uuid) -> Result<VersionsSummary> {
    sqlx::query_as::<_, VersionsSummary>(
        "SELECT COUNT(DISTINCT file_id)::bigint          AS files_with_versions,
                COUNT(*)::bigint                         AS total_versions,
                COALESCE(SUM(size_bytes), 0)::bigint     AS total_bytes
         FROM drive.file_versions
         WHERE owner_id = $1",
    )
    .bind(owner_id)
    .fetch_one(db)
    .await
    .inspect_err(|e| tracing::error!(owner_id = %owner_id, error = %e, "Échec du calcul de la synthèse des versions"))
    .map_err(Into::into)
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
