//! Merging duplicate live rows into the row they duplicate.
//!
//! Concurrent writes could leave several LIVE `drive.files` rows with the same
//! owner, folder and name (two saves of a new draft both finding the name free,
//! a save racing the disk watcher's scan). Migration `live_name_unique` keeps
//! the most recently updated row of each group, records every other one in
//! `drive.duplicate_files` and moves it to the trash so that the unique index
//! can exist — nothing is deleted there. This module finishes the job, at
//! start-up and from `drive:fsck --merge-duplicates`:
//!
//! * the duplicate's versions are renumbered after the keeper's and move to it;
//! * a duplicate whose bytes differ from the keeper's becomes one more version of
//!   the keeper (it is older content of the same document), so its bytes stay
//!   referenced and its charge simply moves from "file" to "version";
//! * its shares, PDF comments, activity, tags, "recent" entries and star move to
//!   the keeper (a tag or recent entry the keeper already has is left behind);
//! * then — in the same transaction — the duplicate row goes, with a tombstone
//!   for sync clients, and its record is cleared.
//!
//! No blob is ever deleted here: bytes either stay with the keeper (shared or
//! kept as a version) or were already missing.

use std::sync::Arc;

use kubuno_db::dialect::SqlType;
use kubuno_db::{new_id, params, DbPool};
use kubuno_storage::{path as storage_path, StorageBackend};
use serde::Serialize;
use uuid::Uuid;

use crate::errors::Result;
use crate::models::File;
use crate::services::{blob_gc, files};
use crate::sync;

#[derive(Debug, Clone, sqlx::FromRow)]
struct Pending {
    file_id: Uuid,
    keeper_id: Uuid,
    owner_id: Uuid,
}

#[derive(sqlx::FromRow)]
struct IdNum {
    id: Uuid,
}

#[derive(sqlx::FromRow)]
struct TagRow {
    tag_id: Uuid,
}

#[derive(sqlx::FromRow)]
struct RecentRow {
    owner_id: Uuid,
    module_id: String,
}

/// What happens to the duplicate's contents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Contents {
    /// Same blob as the keeper: nothing to keep apart.
    Shared,
    /// Different bytes: kept as a version of the keeper.
    KeptAsVersion,
    /// The duplicate's bytes are already gone.
    Missing,
}

/// One recorded duplicate and what merging it does (or did).
#[derive(Debug, Clone, Serialize)]
pub struct DuplicatePlan {
    pub owner_id: Uuid,
    pub duplicate_id: Uuid,
    pub keeper_id: Uuid,
    pub name: String,
    pub duplicate_path: String,
    pub keeper_path: Option<String>,
    pub versions_moved: usize,
    pub contents: Option<Contents>,
    /// The keeper no longer exists: the duplicate is put back in place if its
    /// name is free, otherwise left in the trash.
    pub keeper_missing: bool,
}

/// Outcome of a merge run.
#[derive(Debug, Clone, Default, Serialize)]
pub struct MergeOutcome {
    pub merged: Vec<DuplicatePlan>,
    pub errors: Vec<String>,
}

async fn pending(db: &DbPool, owner: Option<Uuid>) -> Result<Vec<Pending>> {
    let rows = match owner {
        Some(o) => {
            db.fetch_all_as::<Pending>(
                "SELECT file_id, keeper_id, owner_id FROM drive.duplicate_files WHERE owner_id = $1",
                params![o],
            )
            .await
        }
        None => {
            db.fetch_all_as::<Pending>("SELECT file_id, keeper_id, owner_id FROM drive.duplicate_files", params![])
                .await
        }
    }
    .inspect_err(|e| tracing::error!(error = %e, "Failed to list the recorded duplicate files"))?;
    Ok(rows)
}

async fn load(db: &DbPool, id: Uuid) -> Result<Option<File>> {
    Ok(db
        .fetch_optional_as::<File>("SELECT * FROM drive.files WHERE id = $1", params![id])
        .await
        .inspect_err(|e| tracing::error!(file_id = %id, error = %e, "Failed to read a file row"))?)
}

/// Describes what merging each recorded duplicate would do, changing nothing.
pub async fn plan(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner: Option<Uuid>,
) -> Result<Vec<DuplicatePlan>> {
    let mut out = Vec::new();
    for p in pending(db, owner).await? {
        if let Some(plan) = describe(db, storage, &p).await? {
            out.push(plan);
        }
    }
    Ok(out)
}

async fn describe(db: &DbPool, storage: &Arc<dyn StorageBackend>, p: &Pending) -> Result<Option<DuplicatePlan>> {
    let Some(dup) = load(db, p.file_id).await? else {
        return Ok(None);
    };
    let keeper = load(db, p.keeper_id).await?;
    let versions_moved = db
        .fetch_all_as::<IdNum>("SELECT id FROM drive.file_versions WHERE file_id = $1", params![dup.id])
        .await
        .inspect_err(|e| tracing::error!(file_id = %dup.id, error = %e, "Failed to list a duplicate's versions"))?
        .len();
    let contents = match &keeper {
        None => None,
        Some(k) if blob_gc::fs_key(&k.storage_path) == blob_gc::fs_key(&dup.storage_path) => Some(Contents::Shared),
        Some(_) if storage.exists(&dup.storage_path).await.unwrap_or(false) => Some(Contents::KeptAsVersion),
        Some(_) => Some(Contents::Missing),
    };
    Ok(Some(DuplicatePlan {
        owner_id: p.owner_id,
        duplicate_id: dup.id,
        keeper_id: p.keeper_id,
        name: dup.name.clone(),
        duplicate_path: dup.storage_path.clone(),
        keeper_path: keeper.as_ref().map(|k| k.storage_path.clone()),
        versions_moved,
        contents,
        keeper_missing: keeper.is_none(),
    }))
}

/// Merges every recorded duplicate (of `owner`, or all). Idempotent: a merged
/// duplicate leaves the record table; a failure is logged and retried next time.
pub async fn merge_all(db: &DbPool, storage: &Arc<dyn StorageBackend>, owner: Option<Uuid>) -> Result<MergeOutcome> {
    let mut outcome = MergeOutcome::default();
    for p in pending(db, owner).await? {
        match merge_one(db, storage, &p).await {
            Ok(Some(plan)) => outcome.merged.push(plan),
            Ok(None) => {}
            Err(e) => {
                tracing::error!(file_id = %p.file_id, keeper_id = %p.keeper_id, error = %e, "Failed to merge a duplicate file");
                outcome.errors.push(format!("{}: {e}", p.file_id));
            }
        }
    }
    Ok(outcome)
}

async fn clear_record(db: &DbPool, file_id: Uuid) -> Result<()> {
    db.execute("DELETE FROM drive.duplicate_files WHERE file_id = $1", params![file_id])
        .await
        .inspect_err(|e| tracing::error!(file_id = %file_id, error = %e, "Failed to clear a duplicate record"))?;
    Ok(())
}

async fn merge_one(db: &DbPool, storage: &Arc<dyn StorageBackend>, p: &Pending) -> Result<Option<DuplicatePlan>> {
    let Some(mut plan) = describe(db, storage, p).await? else {
        // The duplicate is already gone: nothing left to merge.
        clear_record(db, p.file_id).await?;
        return Ok(None);
    };
    let Some(dup) = load(db, p.file_id).await? else {
        clear_record(db, p.file_id).await?;
        return Ok(None);
    };

    let Some(keeper) = load(db, p.keeper_id).await? else {
        // The keeper was deleted meanwhile: the duplicate takes its place back
        // when its name is free among the live files, otherwise it stays in the
        // trash (restorable, under a unique name).
        let sql = format!(
            "SELECT id FROM drive.files WHERE owner_id = $1 AND {} AND name = $3 AND is_trashed = FALSE AND id <> $4",
            crate::services::null_safe_eq(db.backend(), "folder_id", 2)
        );
        let taken = db
            .fetch_all_as::<IdNum>(&sql, params![dup.owner_id, dup.folder_id, &dup.name, dup.id])
            .await
            .inspect_err(|e| tracing::error!(file_id = %dup.id, error = %e, "Failed to check a duplicate's name"))?;
        let mut tx = db.begin().await?;
        if taken.is_empty() && dup.is_trashed {
            let seq = sync::next_seq(&mut tx).await?;
            tx.execute(
                "UPDATE drive.files SET is_trashed = $1, trashed_at = $2, change_seq = $3 WHERE id = $4",
                params![false, None::<chrono::DateTime<chrono::Utc>>, seq, dup.id],
            )
            .await
            .inspect_err(|e| tracing::error!(file_id = %dup.id, error = %e, "Failed to put a duplicate back"))?;
        }
        tx.execute("DELETE FROM drive.duplicate_files WHERE file_id = $1", params![dup.id])
            .await
            .inspect_err(|e| tracing::error!(file_id = %dup.id, error = %e, "Failed to clear a duplicate record"))?;
        tx.commit().await?;
        return Ok(Some(plan));
    };
    if keeper.owner_id != dup.owner_id {
        tracing::error!(file_id = %dup.id, keeper_id = %keeper.id, "Duplicate and keeper belong to different accounts; left alone");
        return Ok(None);
    }
    let contents = plan.contents.unwrap_or(Contents::Missing);

    // Everything read up front; the transaction below only writes.
    let dup_versions = db
        .fetch_all_as::<IdNum>(
            "SELECT id FROM drive.file_versions WHERE file_id = $1 ORDER BY version_number",
            params![dup.id],
        )
        .await
        .inspect_err(|e| tracing::error!(file_id = %dup.id, error = %e, "Failed to list a duplicate's versions"))?;
    let keeper_tags: Vec<Uuid> = db
        .fetch_all_as::<TagRow>("SELECT tag_id FROM drive.file_tags WHERE file_id = $1", params![keeper.id])
        .await?
        .into_iter()
        .map(|t| t.tag_id)
        .collect();
    let dup_tags: Vec<Uuid> = db
        .fetch_all_as::<TagRow>("SELECT tag_id FROM drive.file_tags WHERE file_id = $1", params![dup.id])
        .await?
        .into_iter()
        .map(|t| t.tag_id)
        .filter(|t| !keeper_tags.contains(t))
        .collect();
    let keeper_recent: Vec<(Uuid, String)> = db
        .fetch_all_as::<RecentRow>("SELECT owner_id, module_id FROM drive.recent_opens WHERE file_id = $1", params![keeper.id])
        .await?
        .into_iter()
        .map(|r| (r.owner_id, r.module_id))
        .collect();
    let dup_recent: Vec<(Uuid, String)> = db
        .fetch_all_as::<RecentRow>("SELECT owner_id, module_id FROM drive.recent_opens WHERE file_id = $1", params![dup.id])
        .await?
        .into_iter()
        .map(|r| (r.owner_id, r.module_id))
        .filter(|r| !keeper_recent.contains(r))
        .collect();

    let mut tx = db.begin().await?;
    let next_sql = format!(
        "SELECT {} FROM drive.file_versions WHERE file_id = $1",
        tx.backend().cast("COALESCE(MAX(version_number), 0)", SqlType::BigInt)
    );
    let mut next: i64 = tx.fetch_optional_scalar::<i64>(&next_sql, params![keeper.id]).await?.unwrap_or(0);
    for v in &dup_versions {
        next += 1;
        tx.execute(
            "UPDATE drive.file_versions SET file_id = $1, version_number = $2 WHERE id = $3",
            params![keeper.id, next as i32, v.id],
        )
        .await
        .inspect_err(|e| tracing::error!(version_id = %v.id, error = %e, "Failed to move a duplicate's version"))?;
    }
    if contents == Contents::KeptAsVersion {
        next += 1;
        tx.execute(
            "INSERT INTO drive.file_versions
                (id, file_id, owner_id, version_number, storage_path, size_bytes, content_hash, comment)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            params![
                new_id(), keeper.id, keeper.owner_id, next as i32, &dup.storage_path, dup.size_bytes,
                dup.content_hash.as_deref(), "Copie en double fusionnée"
            ],
        )
        .await
        .inspect_err(|e| tracing::error!(file_id = %dup.id, error = %e, "Failed to keep a duplicate's contents as a version"))?;
    }
    for table in ["shares", "activity_log", "pdf_comments"] {
        tx.execute(
            &format!("UPDATE drive.{table} SET file_id = $1 WHERE file_id = $2"),
            params![keeper.id, dup.id],
        )
        .await
        .inspect_err(|e| tracing::error!(file_id = %dup.id, table, error = %e, "Failed to move a duplicate's references"))?;
    }
    for tag in &dup_tags {
        tx.execute(
            "UPDATE drive.file_tags SET file_id = $1 WHERE file_id = $2 AND tag_id = $3",
            params![keeper.id, dup.id, *tag],
        )
        .await?;
    }
    for (owner, module) in &dup_recent {
        tx.execute(
            "UPDATE drive.recent_opens SET file_id = $1 WHERE file_id = $2 AND owner_id = $3 AND module_id = $4",
            params![keeper.id, dup.id, *owner, module],
        )
        .await?;
    }
    if dup.is_starred && !keeper.is_starred {
        let seq = sync::next_seq(&mut tx).await?;
        tx.execute(
            "UPDATE drive.files SET is_starred = $1, change_seq = $2 WHERE id = $3",
            params![true, seq, keeper.id],
        )
        .await?;
    }
    tx.execute("DELETE FROM drive.files WHERE id = $1", params![dup.id])
        .await
        .inspect_err(|e| tracing::error!(file_id = %dup.id, error = %e, "Failed to remove a merged duplicate"))?;
    let seq = sync::next_seq(&mut tx).await?;
    sync::record_file_tombstone(&mut tx, dup.id, dup.owner_id, &dup.name, seq).await?;
    tx.execute("DELETE FROM drive.duplicate_files WHERE file_id = $1", params![dup.id]).await?;
    tx.commit()
        .await
        .inspect_err(|e| tracing::error!(file_id = %dup.id, error = %e, "Failed to commit a duplicate merge"))?;

    // The row's charge moves to the new version when its bytes were kept;
    // otherwise the row (counted per row) is simply no longer charged.
    if contents != Contents::KeptAsVersion && dup.size_bytes != 0 {
        files::update_used_bytes(db, dup.owner_id, -dup.size_bytes).await;
    }
    let thumb = storage_path::user_thumbnail_path(dup.owner_id, dup.id);
    if let Err(e) = storage.delete(&thumb.to_string_lossy()).await {
        tracing::warn!(error = %e, "Could not delete a merged duplicate's thumbnail");
    }

    plan.versions_moved = dup_versions.len();
    Ok(Some(plan))
}
