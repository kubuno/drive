//! Trash maintenance: usage stats and a background auto-purge of files that
//! have sat in the trash longer than the retention window (Drive-style).

use std::sync::Arc;
use std::time::Duration;

use kubuno_storage::StorageBackend;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{errors::Result, services::files, state::AppState};

/// Days a trashed file is kept before the auto-purge removes it.
pub const TRASH_RETENTION_DAYS: i32 = 30;

/// Headline stats for a user's trash (counts + reclaimable file size).
pub async fn trash_stats(db: &PgPool, owner_id: Uuid) -> Result<Value> {
    let file_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM drive.files WHERE owner_id = $1 AND is_trashed = TRUE",
    )
    .bind(owner_id)
    .fetch_one(db)
    .await?;

    let file_size: i64 = sqlx::query_scalar(
        // SUM(bigint) yields NUMERIC in Postgres — cast back to BIGINT for i64.
        "SELECT COALESCE(SUM(size_bytes), 0)::BIGINT FROM drive.files WHERE owner_id = $1 AND is_trashed = TRUE",
    )
    .bind(owner_id)
    .fetch_one(db)
    .await?;

    let folder_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM drive.folders WHERE owner_id = $1 AND is_trashed = TRUE",
    )
    .bind(owner_id)
    .fetch_one(db)
    .await?;

    Ok(json!({
        "file_count":   file_count,
        "size_bytes":   file_size,
        "folder_count": folder_count,
        "retention_days": TRASH_RETENTION_DAYS,
    }))
}

/// Permanently removes files trashed longer than `retention_days` (all users).
/// Bounded per run so a huge backlog drains gradually. Returns purged count.
pub async fn purge_old_files(
    db: &PgPool,
    storage: &Arc<dyn StorageBackend>,
    retention_days: i32,
) -> usize {
    let stale: Vec<(Uuid, Uuid, String, i64)> = sqlx::query_as(
        "SELECT id, owner_id, storage_path, size_bytes FROM drive.files
         WHERE is_trashed = TRUE AND trashed_at IS NOT NULL
           AND trashed_at < NOW() - make_interval(days => $1)
         LIMIT 500",
    )
    .bind(retention_days)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let mut purged = 0usize;
    for (id, owner, path, size) in stale {
        let _ = storage.delete(&path).await;
        if sqlx::query("DELETE FROM drive.files WHERE id = $1")
            .bind(id)
            .execute(db)
            .await
            .is_ok()
        {
            files::update_used_bytes(db, owner, -size).await;
            purged += 1;
        }
    }
    purged
}

/// Background worker: hourly, purges files trashed beyond the retention window.
/// The first pass is deferred by one interval so a fresh deploy never purges
/// immediately on boot.
pub async fn run_trash_cleaner(state: AppState) {
    loop {
        tokio::time::sleep(Duration::from_secs(3600)).await;
        let n = purge_old_files(&state.db, &state.storage, TRASH_RETENTION_DAYS).await;
        if n > 0 {
            tracing::info!("Auto-purge corbeille : {n} fichier(s) supprimé(s) définitivement");
        }
    }
}
