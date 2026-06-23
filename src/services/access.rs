use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    errors::Result,
    models::{FileAccess, FrequentFile, RecentFile},
};

/// Records that an application opened a file (centralised "recent files" log).
/// Upserts (one row per owner+file+app), then prunes to the 30 most recent.
pub async fn record_open(db: &PgPool, owner_id: Uuid, file_id: Uuid, module_id: &str) -> Result<()> {
    sqlx::query(
        "INSERT INTO drive.recent_opens (owner_id, file_id, module_id, opened_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (owner_id, file_id, module_id) DO UPDATE SET opened_at = NOW()",
    )
    .bind(owner_id).bind(file_id).bind(module_id)
    .execute(db).await?;
    // Keep only the 30 most recent rows per user.
    sqlx::query(
        "DELETE FROM drive.recent_opens
         WHERE owner_id = $1 AND ctid NOT IN (
             SELECT ctid FROM drive.recent_opens WHERE owner_id = $1 ORDER BY opened_at DESC LIMIT 30
         )",
    )
    .bind(owner_id).execute(db).await?;
    Ok(())
}

/// Lists recently opened files (newest first), optionally filtered by application.
pub async fn list_recent(db: &PgPool, owner_id: Uuid, module: Option<&str>, limit: i64) -> Result<Vec<RecentFile>> {
    let rows = sqlx::query_as::<_, RecentFile>(
        "SELECT f.*, r.module_id, r.opened_at
         FROM drive.recent_opens r
         JOIN drive.files f ON f.id = r.file_id
         WHERE r.owner_id = $1 AND f.is_trashed = FALSE AND ($2::text IS NULL OR r.module_id = $2)
         ORDER BY r.opened_at DESC
         LIMIT $3",
    )
    .bind(owner_id).bind(module).bind(limit.clamp(1, 30))
    .fetch_all(db).await?;
    Ok(rows)
}

pub async fn remove_recent(db: &PgPool, owner_id: Uuid, file_id: Uuid) -> Result<()> {
    sqlx::query("DELETE FROM drive.recent_opens WHERE owner_id = $1 AND file_id = $2")
        .bind(owner_id).bind(file_id).execute(db).await?;
    Ok(())
}

pub async fn clear_recent(db: &PgPool, owner_id: Uuid) -> Result<()> {
    sqlx::query("DELETE FROM drive.recent_opens WHERE owner_id = $1")
        .bind(owner_id).execute(db).await?;
    Ok(())
}

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
