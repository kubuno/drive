//! Trash maintenance: usage stats and a background auto-purge of files that
//! have sat in the trash longer than the retention window (Drive-style).

use std::sync::Arc;
use std::time::Duration;

use kubuno_db::dialect::Unit;
use kubuno_db::{params, DbPool};
use kubuno_storage::StorageBackend;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{errors::Result, services::files, state::AppState};

/// One trashed file eligible for the auto-purge.
#[derive(sqlx::FromRow)]
struct StaleFile {
    id: Uuid,
    owner_id: Uuid,
}

/// Headline stats for a user's trash (counts + reclaimable file size).
pub async fn trash_stats(db: &DbPool, owner_id: Uuid, retention_days: i32) -> Result<Value> {
    let b = db.backend();

    let file_count: i64 = db
        .fetch_scalar(
            &format!(
                "SELECT {} FROM drive.files WHERE owner_id = $1 AND is_trashed = TRUE",
                b.count_bigint("*")
            ),
            params![owner_id],
        )
        .await?;

    let file_size: i64 = db
        .fetch_scalar(
            &format!(
                "SELECT {} FROM drive.files WHERE owner_id = $1 AND is_trashed = TRUE",
                b.sum_bigint("size_bytes")
            ),
            params![owner_id],
        )
        .await?;

    let folder_count: i64 = db
        .fetch_scalar(
            &format!(
                "SELECT {} FROM drive.folders WHERE owner_id = $1 AND is_trashed = TRUE",
                b.count_bigint("*")
            ),
            params![owner_id],
        )
        .await?;

    Ok(json!({
        "file_count":   file_count,
        "size_bytes":   file_size,
        "folder_count": folder_count,
        "retention_days": retention_days,
    }))
}

/// Permanently removes files trashed longer than `retention_days` (all users).
/// Bounded per run so a huge backlog drains gradually. Returns purged count.
pub async fn purge_old_files(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    retention_days: i32,
) -> usize {
    // `make_interval(days => $1)` is PostgreSQL-only; the dialect layer spells
    // `NOW() - INTERVAL 'n day'` per engine (n is a plain integer, never data).
    let cutoff = db.backend().interval_before(retention_days.max(0) as u32, Unit::Day);
    let sql = format!(
        "SELECT id, owner_id FROM drive.files
         WHERE is_trashed = TRUE AND trashed_at IS NOT NULL
           AND trashed_at < {cutoff}
         LIMIT 500"
    );
    let stale: Vec<StaleFile> = match db.fetch_all_as::<StaleFile>(&sql, params![]).await {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, "Trash auto-purge: failed to list the expired files");
            return 0;
        }
    };

    // Each file goes through the one permanent-delete path: rows (file and
    // versions) and tombstone in one transaction, the quota charged back once,
    // the bytes removed after the commit and only when nothing else uses them.
    let mut purged = 0usize;
    for f in stale {
        match files::delete_file_permanently(db, storage, f.owner_id, f.id).await {
            Ok(()) => purged += 1,
            Err(e) => tracing::error!(file_id = %f.id, error = %e, "Trash auto-purge: failed to delete a file"),
        }
    }
    purged
}

/// Background worker: hourly, purges files trashed beyond the retention window.
pub async fn run_trash_cleaner(state: AppState) {
    loop {
        tokio::time::sleep(Duration::from_secs(3600)).await;
        let retention = state.instance().trash_retention_days;
        let n = purge_old_files(&state.db, &state.storage, retention).await;
        if n > 0 {
            tracing::info!("Auto-purge corbeille : {n} fichier(s) supprimé(s) définitivement");
        }
    }
}
