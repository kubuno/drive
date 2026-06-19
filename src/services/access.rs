use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    errors::Result,
    models::{FileAccess, FrequentFile},
};

/// Records a view of a file (upsert counter + timestamp). Best-effort.
pub async fn record_view(db: &PgPool, file_id: Uuid, owner_id: Uuid) -> Result<()> {
    sqlx::query(
        "INSERT INTO drive.file_access (file_id, owner_id, view_count, last_viewed_at)
         VALUES ($1, $2, 1, NOW())
         ON CONFLICT (file_id)
         DO UPDATE SET view_count = drive.file_access.view_count + 1, last_viewed_at = NOW()",
    )
    .bind(file_id)
    .bind(owner_id)
    .execute(db)
    .await?;
    Ok(())
}

/// Records a download of a file (upsert counter + timestamp). Best-effort.
pub async fn record_download(db: &PgPool, file_id: Uuid, owner_id: Uuid) -> Result<()> {
    sqlx::query(
        "INSERT INTO drive.file_access (file_id, owner_id, download_count, last_downloaded_at)
         VALUES ($1, $2, 1, NOW())
         ON CONFLICT (file_id)
         DO UPDATE SET download_count = drive.file_access.download_count + 1, last_downloaded_at = NOW()",
    )
    .bind(file_id)
    .bind(owner_id)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn get_access(db: &PgPool, file_id: Uuid) -> Result<Option<FileAccess>> {
    let row = sqlx::query_as::<_, FileAccess>(
        "SELECT * FROM drive.file_access WHERE file_id = $1",
    )
    .bind(file_id)
    .fetch_optional(db)
    .await?;
    Ok(row)
}

/// The user's most-viewed, non-trashed files.
pub async fn frequent(db: &PgPool, owner_id: Uuid, limit: i64) -> Result<Vec<FrequentFile>> {
    let rows = sqlx::query_as::<_, FrequentFile>(
        "SELECT a.file_id, f.name, f.mime_type, f.has_thumbnail,
                a.view_count, a.last_viewed_at
         FROM drive.file_access a
         JOIN drive.files f ON f.id = a.file_id
         WHERE a.owner_id = $1 AND f.is_trashed = FALSE AND a.view_count > 0
         ORDER BY a.view_count DESC, a.last_viewed_at DESC NULLS LAST
         LIMIT $2",
    )
    .bind(owner_id)
    .bind(limit.clamp(1, 100))
    .fetch_all(db)
    .await?;
    Ok(rows)
}
