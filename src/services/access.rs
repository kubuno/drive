use kubuno_db::dialect::Assign;
use kubuno_db::{params, DbPool, DbQueryBuilder};
use uuid::Uuid;

use crate::{
    errors::Result,
    models::{FileAccess, FrequentFile, RecentFile},
};

/// Records that an application opened a file (centralised "recent files" log).
/// Upserts (one row per owner+file+app), then prunes to the 30 most recent.
pub async fn record_open(db: &DbPool, owner_id: Uuid, file_id: Uuid, module_id: &str) -> Result<()> {
    let b = db.backend();
    let now = chrono::Utc::now();
    db.execute(
        &format!(
            "INSERT INTO drive.recent_opens (owner_id, file_id, module_id, opened_at)
             VALUES ($1, $2, $3, $4){}",
            b.upsert(
                "drive.recent_opens",
                &["owner_id", "file_id", "module_id"],
                &[Assign::Incoming("opened_at")]
            )
        ),
        params![owner_id, file_id, module_id, now],
    )
    .await?;

    // Keep only the 30 most recent rows per user. `ctid` is PostgreSQL-only, so
    // the cutoff is the 30th-newest `opened_at` and anything strictly older goes
    // (owner_id is bound twice — a placeholder may not be reused).
    db.execute(
        "DELETE FROM drive.recent_opens
         WHERE owner_id = $1 AND opened_at < (
             SELECT MIN(t.opened_at) FROM (
                 SELECT opened_at FROM drive.recent_opens
                 WHERE owner_id = $2 ORDER BY opened_at DESC LIMIT 30
             ) t
         )",
        params![owner_id, owner_id],
    )
    .await?;
    Ok(())
}

/// Lists recently opened files (newest first), optionally filtered by application.
pub async fn list_recent(
    db: &DbPool,
    owner_id: Uuid,
    module: Option<&str>,
    limit: i64,
) -> Result<Vec<RecentFile>> {
    let mut qb = DbQueryBuilder::new(
        db.backend(),
        "SELECT f.*, r.module_id, r.opened_at
         FROM drive.recent_opens r
         JOIN drive.files f ON f.id = r.file_id
         WHERE r.owner_id = ",
    );
    qb.push_bind(owner_id).push(" AND f.is_trashed = FALSE");
    if let Some(m) = module {
        qb.push(" AND r.module_id = ").push_bind(m);
    }
    qb.push(" ORDER BY r.opened_at DESC LIMIT ").push_bind(limit.clamp(1, 30));
    let rows: Vec<RecentFile> = qb.fetch_all_as(db).await?;
    Ok(rows)
}

pub async fn remove_recent(db: &DbPool, owner_id: Uuid, file_id: Uuid) -> Result<()> {
    db.execute(
        "DELETE FROM drive.recent_opens WHERE owner_id = $1 AND file_id = $2",
        params![owner_id, file_id],
    )
    .await?;
    Ok(())
}

pub async fn clear_recent(db: &DbPool, owner_id: Uuid) -> Result<()> {
    db.execute("DELETE FROM drive.recent_opens WHERE owner_id = $1", params![owner_id]).await?;
    Ok(())
}

/// Records a view of a file (upsert counter + timestamp). Best-effort.
pub async fn record_view(db: &DbPool, file_id: Uuid, owner_id: Uuid) -> Result<()> {
    let b = db.backend();
    let now = chrono::Utc::now();
    db.execute(
        &format!(
            "INSERT INTO drive.file_access (file_id, owner_id, view_count, last_viewed_at)
             VALUES ($1, $2, 1, $3){}",
            b.upsert(
                "drive.file_access",
                &["file_id"],
                &[
                    Assign::Expr { col: "view_count", expr: "{cur} + 1" },
                    Assign::Incoming("last_viewed_at"),
                ]
            )
        ),
        params![file_id, owner_id, now],
    )
    .await?;
    Ok(())
}

/// Records a download of a file (upsert counter + timestamp). Best-effort.
pub async fn record_download(db: &DbPool, file_id: Uuid, owner_id: Uuid) -> Result<()> {
    let b = db.backend();
    let now = chrono::Utc::now();
    db.execute(
        &format!(
            "INSERT INTO drive.file_access (file_id, owner_id, download_count, last_downloaded_at)
             VALUES ($1, $2, 1, $3){}",
            b.upsert(
                "drive.file_access",
                &["file_id"],
                &[
                    Assign::Expr { col: "download_count", expr: "{cur} + 1" },
                    Assign::Incoming("last_downloaded_at"),
                ]
            )
        ),
        params![file_id, owner_id, now],
    )
    .await?;
    Ok(())
}

pub async fn get_access(db: &DbPool, file_id: Uuid) -> Result<Option<FileAccess>> {
    let row = db
        .fetch_optional_as::<FileAccess>(
            "SELECT * FROM drive.file_access WHERE file_id = $1",
            params![file_id],
        )
        .await?;
    Ok(row)
}

/// The user's most-viewed, non-trashed files.
pub async fn frequent(db: &DbPool, owner_id: Uuid, limit: i64) -> Result<Vec<FrequentFile>> {
    // `NULLS LAST` is not portable (MySQL rejects the syntax); `last_viewed_at
    // DESC` already sorts NULLs last on MySQL and is only a tiebreak here.
    let rows = db
        .fetch_all_as::<FrequentFile>(
            "SELECT a.file_id, f.name, f.mime_type, f.has_thumbnail,
                    a.view_count, a.last_viewed_at
             FROM drive.file_access a
             JOIN drive.files f ON f.id = a.file_id
             WHERE a.owner_id = $1 AND f.is_trashed = FALSE AND a.view_count > 0
             ORDER BY a.view_count DESC, a.last_viewed_at DESC
             LIMIT $2",
            params![owner_id, limit.clamp(1, 100)],
        )
        .await?;
    Ok(rows)
}
