//! Safe removal of storage blobs and folder directories.
//!
//! A file's bytes are addressed by the `storage_path` of its row, a relative key
//! that mirrors the virtual tree (`{owner}/files/{folder path}/{name}`). Two rules
//! keep the database and the storage consistent:
//!
//! * bytes are removed only AFTER the rows that pointed at them are deleted and
//!   committed (a crash in between leaves an orphan blob — wasted space, which the
//!   scanner or the usage recount reconciles — never a live row without bytes);
//! * bytes are removed only when no live row of the owner still references them
//!   (`drive.files` or `drive.file_versions`): two rows can share one path (a live
//!   file re-using the name of a trashed one), and a directory can hold the bytes
//!   of a file outside the deleted subtree (a case-insensitive sibling folder on
//!   Windows/macOS, a path left behind by an interrupted move).

use std::collections::HashSet;
use std::sync::Arc;

use kubuno_db::{params, DbPool};
use kubuno_storage::StorageBackend;
use uuid::Uuid;

use crate::errors::Result;

#[derive(sqlx::FromRow)]
struct PathRow {
    storage_path: String,
}

/// Comparison key of a storage-relative path.
///
/// Stored paths are built with `PathBuf::join`, so they use `\` on Windows —
/// mixed with the `/` of a nested virtual folder path — and `/` elsewhere; the
/// Windows and macOS file systems are case-insensitive. The key unifies the
/// separators, drops empty / `.` segments and folds case, so that two spellings
/// reaching the same file on ANY supported OS compare equal. Folding case is
/// conservative on Linux: it can only keep a blob that could have gone, never
/// delete one that is still referenced.
pub fn path_key(path: &str) -> String {
    path.replace('\\', "/")
        .split('/')
        .filter(|s| !s.is_empty() && *s != ".")
        .collect::<Vec<_>>()
        .join("/")
        .to_lowercase()
}

/// The storage keys every live row of an owner references (files and versions).
pub struct LiveRefs(HashSet<String>);

impl LiveRefs {
    /// Loads every `storage_path` the owner's rows still reference. Must be called
    /// after the transaction that deleted the doomed rows has committed.
    pub async fn load(db: &DbPool, owner_id: Uuid) -> Result<Self> {
        let rows = db
            .fetch_all_as::<PathRow>(
                "SELECT storage_path FROM drive.files WHERE owner_id = $1
                 UNION ALL
                 SELECT storage_path FROM drive.file_versions WHERE owner_id = $2",
                params![owner_id, owner_id],
            )
            .await
            .inspect_err(|e| tracing::error!(owner_id = %owner_id, error = %e, "Failed to load the live storage references"))?;
        Ok(Self(rows.into_iter().map(|r| path_key(&r.storage_path)).collect()))
    }

    /// True when a live row references exactly this blob.
    pub fn references(&self, path: &str) -> bool {
        self.0.contains(&path_key(path))
    }

    /// True when a live row references a blob anywhere under this directory.
    pub fn references_under(&self, dir: &str) -> bool {
        let prefix = format!("{}/", path_key(dir));
        self.0.iter().any(|k| k.starts_with(&prefix))
    }
}

/// Targeted variant of [`LiveRefs::references`] for a single blob: true when a
/// live row of the owner still references `path`, in any separator spelling.
/// Cheaper than loading every reference when only one blob is at stake.
pub async fn is_referenced(db: &DbPool, owner_id: Uuid, path: &str) -> Result<bool> {
    let slash = path.replace('\\', "/");
    let backslash = path.replace('/', "\\");
    let hit = db
        .fetch_optional_as::<PathRow>(
            "SELECT storage_path FROM drive.files
               WHERE owner_id = $1 AND storage_path IN ($2, $3, $4)
             UNION ALL
             SELECT storage_path FROM drive.file_versions
               WHERE owner_id = $5 AND storage_path IN ($6, $7, $8)
             LIMIT 1",
            params![owner_id, path, &slash, &backslash, owner_id, path, &slash, &backslash],
        )
        .await
        .inspect_err(|e| tracing::error!(owner_id = %owner_id, error = %e, "Failed to check a storage reference"))?;
    Ok(hit.is_some())
}

/// Deletes the blob at `path` unless a live row of the owner still references it.
/// Storage failures are logged, never fatal: the row is already gone, so a
/// leftover blob is only wasted space.
pub async fn delete_blob_if_unreferenced(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    path: &str,
) -> Result<()> {
    if is_referenced(db, owner_id, path).await? {
        tracing::warn!(path, "Blob kept: a live row still references it");
        return Ok(());
    }
    if let Err(e) = storage.delete(path).await {
        tracing::warn!(path, error = %e, "Could not delete a storage blob");
    }
    Ok(())
}

/// Deletes each blob of `paths` that no live row references.
pub async fn delete_unreferenced(storage: &Arc<dyn StorageBackend>, live: &LiveRefs, paths: &[String]) {
    for path in paths {
        let path = path.as_str();
        if live.references(path) {
            tracing::warn!(path, "Blob kept: a live row still references it");
            continue;
        }
        if let Err(e) = storage.delete(path).await {
            tracing::warn!(path, error = %e, "Could not delete a storage blob");
        }
    }
}

/// Removes the on-disk directory of a deleted folder subtree.
///
/// `root_dir` is the storage directory of the deleted folder, `dirs` those of
/// every folder of its subtree (root included). When no live row references
/// anything under `root_dir` the whole tree is removed at once. Otherwise only
/// the unreferenced files of the known directories are deleted and the
/// directories are kept, so the still-referenced bytes survive.
pub async fn remove_folder_dirs(
    storage: &Arc<dyn StorageBackend>,
    live: &LiveRefs,
    root_dir: &str,
    dirs: &[String],
) {
    if !live.references_under(root_dir) {
        if let Err(e) = storage.delete_dir(root_dir).await {
            tracing::warn!(path = root_dir, error = %e, "Could not delete folder directory");
        }
        return;
    }

    tracing::warn!(
        path = root_dir,
        "Folder directory kept: live rows outside the deleted subtree still reference bytes under it"
    );
    for dir in dirs {
        let prefix = format!("{}/", path_key(dir));
        let objects = match storage.list(dir).await {
            Ok(objects) => objects,
            // Absent directory: nothing to clean.
            Err(_) => continue,
        };
        for obj in objects {
            // Only ever touch what really lies in this directory.
            if !path_key(&obj.path).starts_with(&prefix) || live.references(&obj.path) {
                continue;
            }
            if let Err(e) = storage.delete(&obj.path).await {
                tracing::warn!(path = %obj.path, error = %e, "Could not delete a storage blob");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_key_unifies_separators_and_case() {
        assert_eq!(path_key(r"U\files\Docs/Sub\a.TXT"), "u/files/docs/sub/a.txt");
        assert_eq!(path_key("/u/files//Docs/./a.txt"), "u/files/docs/a.txt");
        assert_eq!(path_key("u/files/Docs/"), "u/files/docs");
    }

    #[test]
    fn references_under_matches_whole_segments_only() {
        let live = LiveRefs([path_key(r"u\files\Docs2\a.txt")].into_iter().collect());
        assert!(!live.references_under("u/files/Docs"), "Docs2 is not under Docs");
        assert!(live.references_under("u/files/docs2"));
        assert!(live.references(r"U/FILES/docs2/A.txt"));
    }
}
