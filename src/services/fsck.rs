//! Consistency check between the file rows and the storage — `drive:fsck`.
//!
//! Lists the two kinds of damage the old deletion and naming code could leave
//! behind:
//!
//! * **rows without bytes** — a `drive.files` or `drive.file_versions` row whose
//!   `storage_path` points at nothing (a folder deleted for good used to wipe the
//!   bytes of files it re-parented to the root, and emptying the trash could
//!   delete the bytes of a live file sharing them);
//! * **rows sharing one blob** — several rows reading and writing the same
//!   location (a live file uploaded under the name of a trashed one in the same
//!   folder): writing, moving or deleting one silently affects the others.
//!
//! The check is read-only unless a repair is asked for explicitly:
//!
//! * `split_shared` gives every row of a shared blob but one its own copy of the
//!   bytes (copy first, then repoint the row; a crash in between leaves a spare
//!   copy, never a broken row). Contents a row already lost cannot come back:
//!   they were overwritten before this check ran.
//! * `trash_missing` moves the live files whose bytes are confirmed absent to the
//!   trash — reversible, and it makes the damage visible to their owner instead
//!   of failing on open. Nothing is ever hard-deleted.

use std::collections::BTreeMap;
use std::sync::Arc;

use kubuno_db::{params, DbPool};
use kubuno_storage::StorageBackend;
use serde::Serialize;
use uuid::Uuid;

use crate::errors::Result;
use crate::services::{blob_gc, files};
use crate::sync;

/// What to check, and which repairs (if any) to apply.
#[derive(Debug, Clone, Default)]
pub struct FsckOptions {
    /// Restrict the check to one account.
    pub owner: Option<Uuid>,
    /// Give each row of a shared blob its own copy.
    pub split_shared: bool,
    /// Move the live files whose bytes are gone to the trash.
    pub trash_missing: bool,
}

/// A row whose bytes are not in the storage.
#[derive(Debug, Clone, Serialize)]
pub struct MissingBlob {
    /// `"file"` or `"version"`.
    pub kind: &'static str,
    pub id: Uuid,
    pub owner_id: Uuid,
    /// The file the row belongs to (itself for a file row).
    pub file_id: Uuid,
    pub name: String,
    pub storage_path: String,
    pub is_trashed: bool,
    /// Set when the storage could not even be asked (invalid path, I/O error):
    /// such a row is reported, never repaired.
    pub error: Option<String>,
}

/// One row of a shared blob.
#[derive(Debug, Clone, Serialize)]
pub struct SharedRow {
    pub kind: &'static str,
    pub id: Uuid,
    pub name: String,
    pub storage_path: String,
    pub is_trashed: bool,
}

/// Several rows pointing at the same location.
#[derive(Debug, Clone, Serialize)]
pub struct SharedBlob {
    pub owner_id: Uuid,
    pub rows: Vec<SharedRow>,
}

/// The outcome of a check (and of the repairs, when asked for).
#[derive(Debug, Clone, Default, Serialize)]
pub struct FsckReport {
    pub dry_run: bool,
    pub owners_checked: u64,
    pub files_checked: u64,
    pub versions_checked: u64,
    pub missing: Vec<MissingBlob>,
    pub shared: Vec<SharedBlob>,
    /// Rows given their own copy of a shared blob.
    pub split: u64,
    /// Live files moved to the trash because their bytes are gone.
    pub trashed: u64,
    /// Repairs that could not be applied (each also logged).
    pub repair_errors: Vec<String>,
}

#[derive(sqlx::FromRow)]
struct OwnerRow {
    owner_id: Uuid,
}

#[derive(sqlx::FromRow)]
struct FileRow {
    id: Uuid,
    folder_id: Option<Uuid>,
    name: String,
    storage_path: String,
    is_trashed: bool,
}

#[derive(sqlx::FromRow)]
struct VersionRow {
    id: Uuid,
    file_id: Uuid,
    storage_path: String,
}

/// Runs the check over every account (or `opts.owner`).
pub async fn run(db: &DbPool, storage: &Arc<dyn StorageBackend>, opts: &FsckOptions) -> Result<FsckReport> {
    let mut report = FsckReport { dry_run: !(opts.split_shared || opts.trash_missing), ..Default::default() };

    let owners: Vec<Uuid> = match opts.owner {
        Some(o) => vec![o],
        None => db
            .fetch_all_as::<OwnerRow>(
                "SELECT DISTINCT owner_id FROM drive.files
                 UNION
                 SELECT DISTINCT owner_id FROM drive.file_versions",
                params![],
            )
            .await
            .inspect_err(|e| tracing::error!(error = %e, "fsck: failed to list the accounts"))?
            .into_iter()
            .map(|r| r.owner_id)
            .collect(),
    };

    for owner_id in owners {
        check_owner(db, storage, owner_id, opts, &mut report).await?;
        report.owners_checked += 1;
    }
    Ok(report)
}

async fn check_owner(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    opts: &FsckOptions,
    report: &mut FsckReport,
) -> Result<()> {
    let file_rows: Vec<FileRow> = db
        .fetch_all_as::<FileRow>(
            "SELECT id, folder_id, name, storage_path, is_trashed FROM drive.files WHERE owner_id = $1",
            params![owner_id],
        )
        .await
        .inspect_err(|e| tracing::error!(owner_id = %owner_id, error = %e, "fsck: failed to list the files"))?;
    let version_rows: Vec<VersionRow> = db
        .fetch_all_as::<VersionRow>(
            "SELECT id, file_id, storage_path FROM drive.file_versions WHERE owner_id = $1",
            params![owner_id],
        )
        .await
        .inspect_err(|e| tracing::error!(owner_id = %owner_id, error = %e, "fsck: failed to list the versions"))?;
    report.files_checked += file_rows.len() as u64;
    report.versions_checked += version_rows.len() as u64;

    // ── Rows without bytes ──
    let mut confirmed_missing: Vec<&FileRow> = Vec::new();
    for f in &file_rows {
        match storage.exists(&f.storage_path).await {
            Ok(true) => {}
            Ok(false) => {
                confirmed_missing.push(f);
                report.missing.push(missing("file", f.id, owner_id, f.id, &f.name, &f.storage_path, f.is_trashed, None));
            }
            Err(e) => report.missing.push(missing(
                "file", f.id, owner_id, f.id, &f.name, &f.storage_path, f.is_trashed, Some(e.to_string()),
            )),
        }
    }
    for v in &version_rows {
        let error = match storage.exists(&v.storage_path).await {
            Ok(true) => continue,
            Ok(false) => None,
            Err(e) => Some(e.to_string()),
        };
        report.missing.push(missing("version", v.id, owner_id, v.file_id, "", &v.storage_path, false, error));
    }

    // ── Rows sharing one location (as this platform's file system sees it) ──
    let mut by_location: BTreeMap<String, Vec<SharedRow>> = BTreeMap::new();
    for f in &file_rows {
        by_location.entry(blob_gc::fs_key(&f.storage_path)).or_default().push(SharedRow {
            kind: "file",
            id: f.id,
            name: f.name.clone(),
            storage_path: f.storage_path.clone(),
            is_trashed: f.is_trashed,
        });
    }
    for v in &version_rows {
        by_location.entry(blob_gc::fs_key(&v.storage_path)).or_default().push(SharedRow {
            kind: "version",
            id: v.id,
            name: String::new(),
            storage_path: v.storage_path.clone(),
            is_trashed: false,
        });
    }
    let shared: Vec<Vec<SharedRow>> = by_location.into_values().filter(|rows| rows.len() > 1).collect();

    // ── Repairs (explicit only) ──
    if opts.split_shared {
        for rows in &shared {
            split_one(db, storage, owner_id, rows, &file_rows, report).await;
        }
    }
    if opts.trash_missing {
        for f in confirmed_missing.iter().filter(|f| !f.is_trashed) {
            match trash_row(db, f.id).await {
                Ok(()) => report.trashed += 1,
                Err(e) => {
                    tracing::error!(file_id = %f.id, error = %e, "fsck: could not trash a file without bytes");
                    report.repair_errors.push(format!("trash {}: {e}", f.id));
                }
            }
        }
    }

    report.shared.extend(shared.into_iter().map(|rows| SharedBlob { owner_id, rows }));
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn missing(
    kind: &'static str,
    id: Uuid,
    owner_id: Uuid,
    file_id: Uuid,
    name: &str,
    storage_path: &str,
    is_trashed: bool,
    error: Option<String>,
) -> MissingBlob {
    MissingBlob {
        kind,
        id,
        owner_id,
        file_id,
        name: name.to_string(),
        storage_path: storage_path.to_string(),
        is_trashed,
        error,
    }
}

/// Gives every FILE row of a shared blob but one (a live row when there is one)
/// its own copy. Version rows are never shared by construction and are left
/// alone; a blob that is already gone has nothing to copy.
async fn split_one(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    rows: &[SharedRow],
    file_rows: &[FileRow],
    report: &mut FsckReport,
) {
    let files_in_group: Vec<&FileRow> = rows
        .iter()
        .filter(|r| r.kind == "file")
        .filter_map(|r| file_rows.iter().find(|f| f.id == r.id))
        .collect();
    let keeper = files_in_group
        .iter()
        .find(|f| !f.is_trashed)
        .or_else(|| files_in_group.first())
        .map(|f| f.id);
    for f in files_in_group.iter().filter(|f| Some(f.id) != keeper) {
        match split_row(db, storage, owner_id, f).await {
            Ok(()) => report.split += 1,
            Err(e) => {
                tracing::error!(file_id = %f.id, error = %e, "fsck: could not give a file its own copy");
                report.repair_errors.push(format!("split {}: {e}", f.id));
            }
        }
    }
}

async fn split_row(db: &DbPool, storage: &Arc<dyn StorageBackend>, owner_id: Uuid, f: &FileRow) -> Result<()> {
    let virt_path = files::folder_virt_path(db, f.folder_id, owner_id).await?;
    let target = files::allocate_storage_path(db, storage, owner_id, &virt_path, &f.name, None).await?;
    // Copy first: until the row is repointed it still reads the shared bytes.
    storage.copy(&f.storage_path, &target).await?;
    let mut tx = db.begin().await?;
    let seq = sync::next_seq(&mut tx).await?;
    tx.execute(
        "UPDATE drive.files SET storage_path = $1, change_seq = $2 WHERE id = $3 AND storage_path = $4",
        params![&target, seq, f.id, &f.storage_path],
    )
    .await
    .inspect_err(|e| tracing::error!(file_id = %f.id, error = %e, "fsck: failed to repoint a file"))?;
    tx.commit().await?;
    Ok(())
}

async fn trash_row(db: &DbPool, file_id: Uuid) -> Result<()> {
    let mut tx = db.begin().await?;
    let seq = sync::next_seq(&mut tx).await?;
    tx.execute(
        "UPDATE drive.files SET is_trashed = $1, trashed_at = $2, change_seq = $3 WHERE id = $4 AND is_trashed = $5",
        params![true, chrono::Utc::now(), seq, file_id, false],
    )
    .await
    .inspect_err(|e| tracing::error!(file_id = %file_id, error = %e, "fsck: failed to trash a file"))?;
    tx.commit().await?;
    Ok(())
}
