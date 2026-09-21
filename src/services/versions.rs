use bytes::Bytes;
use kubuno_db::dialect::SqlType;
use kubuno_db::{params, DbPool, DbQueryBuilder};
use kubuno_storage::{path as storage_path, StorageBackend};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    models::{File, FileVersion, Folder, VersionsPurgeResult, VersionsSummary},
    services::files::{get_file, update_used_bytes},
    sync,
};

/// One version row projected for pruning/purging.
#[derive(sqlx::FromRow)]
struct VersionBlob {
    id: Uuid,
    storage_path: String,
    size_bytes: i64,
}

// ── Lecture ───────────────────────────────────────────────────────────────────

pub async fn list_versions(db: &DbPool, owner_id: Uuid, file_id: Uuid) -> Result<Vec<FileVersion>> {
    get_file(db, owner_id, file_id).await?;
    let versions = db
        .fetch_all_as::<FileVersion>(
            "SELECT * FROM drive.file_versions WHERE file_id = $1 ORDER BY version_number DESC",
            params![file_id],
        )
        .await?;
    Ok(versions)
}

pub async fn get_version(
    db: &DbPool,
    owner_id: Uuid,
    file_id: Uuid,
    version_id: Uuid,
) -> Result<FileVersion> {
    get_file(db, owner_id, file_id).await?;
    db.fetch_optional_as::<FileVersion>(
        "SELECT * FROM drive.file_versions WHERE id = $1 AND file_id = $2",
        params![version_id, file_id],
    )
    .await?
    .ok_or_else(|| FilesError::NotFound(format!("Version {version_id} introuvable")))
}

// ── Création ──────────────────────────────────────────────────────────────────

/// Crée un snapshot de la version actuelle du fichier.
pub async fn create_version(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    file_id: Uuid,
    comment: Option<String>,
    max_versions: i64,
) -> Result<FileVersion> {
    let file = get_file(db, owner_id, file_id).await?;

    // Next version number. Decoded at a portable BIGINT width (a bare int4 MAX
    // would refuse an i64 decode on PostgreSQL), then narrowed to the column's INT.
    let next_num_wide: i64 = db
        .fetch_scalar::<i64>(
            &format!(
                "SELECT {} FROM drive.file_versions WHERE file_id = $1",
                db.backend().cast("COALESCE(MAX(version_number), 0) + 1", SqlType::BigInt)
            ),
            params![file_id],
        )
        .await?;
    let next_num = next_num_wide as i32;

    // Copier le fichier courant vers le chemin de version.
    let version_path = storage_path::user_version_path(owner_id, file_id, next_num, &file.name);
    let version_path_str = version_path.to_string_lossy().to_string();

    let data = storage.get(&file.storage_path).await?;
    storage.put(&version_path_str, Bytes::from(data.to_vec())).await?;

    // Mint the id in Rust and reselect (no RETURNING on MySQL).
    let id = kubuno_db::new_id();
    db.execute(
        "INSERT INTO drive.file_versions
            (id, file_id, owner_id, version_number, storage_path, size_bytes, content_hash, comment)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        params![
            id, file_id, owner_id, next_num, version_path_str, file.size_bytes,
            file.content_hash, comment
        ],
    )
    .await?;
    let version = db
        .fetch_one_as::<FileVersion>("SELECT * FROM drive.file_versions WHERE id = $1", params![id])
        .await?;

    // A revision is a full copy of the blob, so it costs the account exactly the
    // size of the file it froze. It is charged because the account can now see
    // it and give it back.
    update_used_bytes(db, owner_id, file.size_bytes).await;

    // Retention: keep at most `max_versions`. `OFFSET` without `LIMIT` is not
    // portable (MySQL requires a `LIMIT`), so the ordered list is read and the
    // ones past the limit are pruned in Rust.
    let all: Vec<VersionBlob> = db
        .fetch_all_as(
            "SELECT id, storage_path, size_bytes FROM drive.file_versions
             WHERE file_id = $1 ORDER BY version_number DESC",
            params![file_id],
        )
        .await
        .inspect_err(|e| tracing::error!(file_id = %file_id, error = %e, "Échec de lecture des versions à élaguer"))
        .unwrap_or_default();
    let mut pruned = 0i64;
    for v in all.into_iter().skip(max_versions.max(0) as usize) {
        if let Err(e) = storage.delete(&v.storage_path).await {
            tracing::warn!(path = %v.storage_path, error = %e, "Impossible de supprimer le blob d'une version élaguée");
        }
        match db
            .execute("DELETE FROM drive.file_versions WHERE id = $1", params![v.id])
            .await
        {
            Ok(_) => pruned += v.size_bytes,
            Err(e) => tracing::error!(version_id = %v.id, error = %e, "Échec de suppression d'une version élaguée"),
        }
    }
    if pruned > 0 {
        update_used_bytes(db, owner_id, -pruned).await;
    }

    Ok(version)
}

// ── Restauration ─────────────────────────────────────────────────────────────

/// Restaure une version précédente en l'écrivant comme fichier courant.
pub async fn restore_version(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    file_id: Uuid,
    version_id: Uuid,
    max_versions: i64,
) -> Result<File> {
    let file = get_file(db, owner_id, file_id).await?;
    let version = get_version(db, owner_id, file_id, version_id).await?;

    // Sauvegarder l'état actuel avant de restaurer.
    create_version(db, storage, owner_id, file_id, Some("Avant restauration".into()), max_versions).await?;

    let data = storage.get(&version.storage_path).await?;
    let size = data.len() as i64;
    storage.put(&file.storage_path, Bytes::from(data.to_vec())).await?;

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let hash = hex::encode(hasher.finalize());

    // The content change is a delta-visible file change: stamp a fresh seq.
    let mut tx = db.begin().await?;
    let seq = sync::next_seq(&mut tx).await?;
    tx.execute(
        "UPDATE drive.files SET size_bytes = $1, content_hash = $2, change_seq = $3 WHERE id = $4",
        params![size, hash, seq, file_id],
    )
    .await
    .inspect_err(|e| tracing::error!(file_id = %file_id, error = %e, "Échec d'écriture de la version restaurée"))?;
    tx.commit().await?;

    update_used_bytes(db, owner_id, size - file.size_bytes).await;

    get_file(db, owner_id, file_id).await
}

// ── Suppression ───────────────────────────────────────────────────────────────

pub async fn delete_version(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    file_id: Uuid,
    version_id: Uuid,
) -> Result<()> {
    let version = get_version(db, owner_id, file_id, version_id).await?;

    if let Err(e) = storage.delete(&version.storage_path).await {
        tracing::warn!(path = %version.storage_path, error = %e, "Impossible de supprimer le fichier de version");
    }

    db.execute("DELETE FROM drive.file_versions WHERE id = $1", params![version_id])
        .await
        .inspect_err(|e| tracing::error!(version_id = %version_id, error = %e, "Échec de suppression d'une version"))?;

    update_used_bytes(db, owner_id, -version.size_bytes).await;

    Ok(())
}

/// Deletes a file's **whole** history, keeping the current content.
///
/// The rows are selected by id and then deleted by that exact id set, so a
/// revision created between the two statements is neither counted nor removed —
/// never a deleted row whose blob survives, nor the reverse.
pub async fn purge_versions(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    file_id: Uuid,
) -> Result<VersionsPurgeResult> {
    // Ownership check — also turns an unknown id into a 404.
    get_file(db, owner_id, file_id).await?;

    let rows: Vec<VersionBlob> = db
        .fetch_all_as(
            "SELECT id, storage_path, size_bytes FROM drive.file_versions WHERE file_id = $1",
            params![file_id],
        )
        .await
        .inspect_err(|e| tracing::error!(file_id = %file_id, error = %e, "Échec de purge de l'historique"))?;

    if rows.is_empty() {
        return Ok(VersionsPurgeResult { removed: 0, freed_bytes: 0 });
    }

    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let mut qb = DbQueryBuilder::new(db.backend(), "DELETE FROM drive.file_versions WHERE id");
    qb.push_in(ids.iter().copied());
    qb.execute(db)
        .await
        .inspect_err(|e| tracing::error!(file_id = %file_id, error = %e, "Échec de purge de l'historique"))?;

    let mut freed = 0i64;
    for r in &rows {
        // A blob whose delete fails is still counted as freed: its row is gone,
        // so nothing will ever charge for it again, and the periodic full recount
        // reconciles the disk.
        if let Err(e) = storage.delete(&r.storage_path).await {
            tracing::warn!(path = %r.storage_path, error = %e, "Impossible de supprimer le blob d'une version purgée");
        }
        freed += r.size_bytes;
    }

    update_used_bytes(db, owner_id, -freed).await;

    Ok(VersionsPurgeResult { removed: rows.len() as i64, freed_bytes: freed })
}

/// What every version history of the account weighs, all files together.
pub async fn versions_summary(db: &DbPool, owner_id: Uuid) -> Result<VersionsSummary> {
    let b = db.backend();
    let sql = format!(
        "SELECT {files} AS files_with_versions,
                {total} AS total_versions,
                {bytes} AS total_bytes
         FROM drive.file_versions WHERE owner_id = $1",
        files = b.count_bigint("DISTINCT file_id"),
        total = b.count_bigint("*"),
        bytes = b.sum_bigint("size_bytes"),
    );
    db.fetch_one_as::<VersionsSummary>(&sql, params![owner_id])
        .await
        .inspect_err(|e| tracing::error!(owner_id = %owner_id, error = %e, "Échec du calcul de la synthèse des versions"))
        .map_err(Into::into)
}

// ── Activation ────────────────────────────────────────────────────────────────

pub async fn set_file_versioning(db: &DbPool, owner_id: Uuid, file_id: Uuid, enabled: bool) -> Result<File> {
    // A file property change is delta-visible: stamp a fresh seq.
    let mut tx = db.begin().await?;
    let seq = sync::next_seq(&mut tx).await?;
    let n = tx
        .execute(
            "UPDATE drive.files SET versioning_enabled = $1, change_seq = $2 WHERE id = $3 AND owner_id = $4",
            params![enabled, seq, file_id, owner_id],
        )
        .await?;
    tx.commit().await?;
    if n == 0 {
        return Err(FilesError::NotFound(format!("Fichier {file_id} introuvable")));
    }
    get_file(db, owner_id, file_id).await
}

pub async fn set_folder_versioning(db: &DbPool, owner_id: Uuid, folder_id: Uuid, enabled: bool) -> Result<Folder> {
    let mut tx = db.begin().await?;
    let seq = sync::next_seq(&mut tx).await?;
    let n = tx
        .execute(
            "UPDATE drive.folders SET versioning_enabled = $1, change_seq = $2 WHERE id = $3 AND owner_id = $4",
            params![enabled, seq, folder_id, owner_id],
        )
        .await?;
    tx.commit().await?;
    if n == 0 {
        return Err(FilesError::NotFound(format!("Dossier {folder_id} introuvable")));
    }
    crate::services::folders::get_folder(db, owner_id, folder_id).await
}

// ── Vérification d'héritage ───────────────────────────────────────────────────

/// Renvoie vrai si le versionnage est actif pour ce fichier (directement ou via son dossier).
pub async fn is_versioning_active(db: &DbPool, owner_id: Uuid, file_id: Uuid) -> Result<bool> {
    let row: Option<FileVersioningRow> = db
        .fetch_optional_as::<FileVersioningRow>(
            "SELECT versioning_enabled, folder_id FROM drive.files WHERE id = $1 AND owner_id = $2",
            params![file_id, owner_id],
        )
        .await?;

    let (file_versioning, folder_id) = match row {
        None => return Ok(false),
        Some(r) => (r.versioning_enabled, r.folder_id),
    };

    if file_versioning {
        return Ok(true);
    }

    // Ancestor folders. `bool_or` is PostgreSQL-only, so the flags are read and
    // OR-ed in Rust. owner_id is bound twice (a placeholder may not be reused).
    if let Some(fid) = folder_id {
        let flags: Vec<FlagRow> = db
            .fetch_all_as::<FlagRow>(
                "WITH RECURSIVE ancestors AS (
                    SELECT id, parent_id, versioning_enabled
                    FROM drive.folders WHERE id = $1 AND owner_id = $2
                    UNION ALL
                    SELECT f.id, f.parent_id, f.versioning_enabled
                    FROM drive.folders f
                    JOIN ancestors a ON f.id = a.parent_id
                    WHERE f.owner_id = $3
                 )
                 SELECT versioning_enabled FROM ancestors",
                params![fid, owner_id, owner_id],
            )
            .await?;
        return Ok(flags.iter().any(|f| f.versioning_enabled));
    }

    Ok(false)
}

#[derive(sqlx::FromRow)]
struct FileVersioningRow {
    versioning_enabled: bool,
    folder_id: Option<Uuid>,
}

#[derive(sqlx::FromRow)]
struct FlagRow {
    versioning_enabled: bool,
}
