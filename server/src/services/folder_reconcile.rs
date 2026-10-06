//! Startup reconciliation of stored folder paths.
//!
//! Split out of `folders.rs` (feature-per-file): folder CRUD stays there, while
//! the one-shot boot-time repair of folders whose stored `path` drifted from
//! their `name` lives here as its own concern. Called once from `main.rs` at
//! startup. See [`reconcile_folder_paths`].

use kubuno_db::{params, DbPool};
use kubuno_storage::StorageBackend;
use std::sync::Arc;
use uuid::Uuid;

use crate::errors::Result;
use crate::sync;

/// Lightweight row for the folder-tree walk in [`reconcile_folder_paths`].
#[derive(sqlx::FromRow)]
struct FolderPathRow {
    id:        Uuid,
    owner_id:  Uuid,
    parent_id: Option<Uuid>,
    name:      String,
    path:      String,
}

/// A single file to relocate when its folder is repathed.
#[derive(sqlx::FromRow)]
struct FileMoveRow {
    id:           Uuid,
    name:         String,
    storage_path: String,
}

/// Startup reconciliation: repair folders whose stored `path` no longer matches
/// the path derived from their parent chain and their own `name`.
///
/// `path` is a stored column, kept in sync by `create_folder` and
/// `rename_folder`. But `rename_folder` refuses protected folders, so a module
/// that renamed a protected folder with a raw `UPDATE ... SET name` left `name`
/// disagreeing with the last segment of the stored `path`. On instances where
/// that happened, the desktop sync client sees two folders claiming the same
/// local path and materialises neither of them.
///
/// This walks folders parent-first, recomputes each folder's canonical path from
/// its parent's (already corrected) path plus its own `name`, and where it
/// differs repaths the folder: it moves the folder's files ONE BY ONE to their
/// new `storage_path` and updates the folder's `path`. Files are moved
/// individually — never with a directory move — because a stale protected folder
/// can share its physical subtree with a sibling that legitimately owns that
/// path, and a wholesale directory move would carry the sibling's bytes away.
/// Every UPDATE bumps `change_seq` through the existing trigger, so sync clients
/// pick the corrected paths up on their next delta.
///
/// Idempotent — a no-op on healthy instances. A folder whose corrected path is
/// already taken by a different folder of the same owner is skipped and logged,
/// so genuine data is never clobbered. Returns the number of folders repathed.
pub async fn reconcile_folder_paths(
    db:      &DbPool,
    storage: &Arc<dyn StorageBackend>,
) -> Result<u64> {
    // Depth in the parent tree (root = 0), computed from `parent_id` and NOT
    // from the possibly-stale `path` string. Shallow-first ordering guarantees a
    // parent's path is already corrected when we compute its children's.
    let rows = db
        .fetch_all_as::<FolderPathRow>(
            r#"WITH RECURSIVE tree AS (
                   SELECT id, owner_id, parent_id, name, path, 0 AS depth
                   FROM drive.folders
                   WHERE parent_id IS NULL
                 UNION ALL
                   SELECT c.id, c.owner_id, c.parent_id, c.name, c.path, t.depth + 1
                   FROM drive.folders c
                   JOIN tree t ON c.parent_id = t.id
               )
               SELECT id, owner_id, parent_id, name, path
               FROM tree
               ORDER BY depth, id"#,
            params![],
        )
        .await?;

    // Corrected path of every folder we have already visited, so children read
    // the value their parent will actually hold after reconciliation.
    let mut corrected: std::collections::HashMap<Uuid, String> = std::collections::HashMap::new();
    let mut fixed: u64 = 0;
    // Old paths a repathed folder vacated, as (owner, path). A legitimate sibling
    // may still occupy one of these; its subtree is re-emitted after the walk.
    let mut vacated: Vec<(Uuid, String)> = Vec::new();

    for row in rows {
        let canonical = match row.parent_id {
            Some(pid) => match corrected.get(&pid) {
                Some(parent_path) => format!("{parent_path}/{}", row.name),
                // Parent missing from the walk (orphan / cycle guard): leave this
                // folder untouched rather than guessing a path.
                None => {
                    tracing::warn!(
                        folder = %row.id, parent = %pid,
                        "reconcile_folder_paths: parent absent de l'arbre, dossier ignoré"
                    );
                    corrected.insert(row.id, row.path.clone());
                    continue;
                }
            },
            None => format!("/{}", row.name),
        };

        if canonical == row.path {
            corrected.insert(row.id, canonical);
            continue;
        }

        // A different folder of the same owner already occupies the corrected
        // path: a real conflict that needs a human. Skip, keep the stale value
        // for this folder's own children, and log loudly.
        let clash: Option<Uuid> = db
            .fetch_optional_scalar(
                "SELECT id FROM drive.folders WHERE owner_id = $1 AND path = $2 AND id <> $3 LIMIT 1",
                params![row.owner_id, &canonical, row.id],
            )
            .await?;
        if clash.is_some() {
            tracing::error!(
                folder = %row.id, owner = %row.owner_id,
                stale = %row.path, canonical = %canonical,
                "reconcile_folder_paths: chemin corrigé déjà occupé, dossier ignoré (conflit à traiter manuellement)"
            );
            corrected.insert(row.id, row.path.clone());
            continue;
        }

        // Relocate the files sitting DIRECTLY in this folder ONE BY ONE — never
        // a directory move. A stale protected folder can share its physical
        // subtree with a sibling that legitimately owns that path (a module
        // folder left at `/Forge` beside the user's real `Forge` both resolve
        // to `files/Forge/`). A wholesale `mv_dir` would carry the sibling's
        // bytes away and orphan them; moving each file by its own recorded
        // `storage_path` touches only this folder's bytes.
        let files = db
            .fetch_all_as::<FileMoveRow>(
                "SELECT id, name, storage_path FROM drive.files
                 WHERE folder_id = $1 AND owner_id = $2",
                params![row.id, row.owner_id],
            )
            .await?;

        // Phase 1: physical moves, OUTSIDE the transaction. Collect the
        // (file id, new storage_path) pairs whose database row must follow.
        // Storage moves are not transactional, but they are self-recovering:
        // if the run dies before the DB commit below, the next startup sees the
        // bytes already at the destination and takes the "DB-only" branch.
        let mut file_updates: Vec<(Uuid, String)> = Vec::with_capacity(files.len());
        for f in &files {
            let new_sp = format!("{}/files{canonical}/{}", row.owner_id, f.name);
            if new_sp == f.storage_path {
                continue;
            }
            if storage.exists(&f.storage_path).await? {
                // Does another file row (a different folder_id) still point at the
                // very same storage_path? That is the deep aftermath of the folder
                // rename: two logical trees layered over ONE physical subtree, so a
                // file here and a sibling there share a single blob (same name,
                // same storage_path, same content_hash). Moving the blob would yank
                // it out from under the sibling row and break it. COPY instead —
                // leave the sibling's bytes untouched — and let de-duplication be
                // someone else's concern. When the blob is NOT shared, move it.
                // `SELECT EXISTS(...)` returns a boolean on PostgreSQL but a
                // BIGINT 0/1 on MySQL, which does not decode into `bool`; select
                // an id and test presence instead.
                let shared: Option<Uuid> = db
                    .fetch_optional_scalar(
                        "SELECT id FROM drive.files WHERE storage_path = $1 AND id <> $2 LIMIT 1",
                        params![&f.storage_path, f.id],
                    )
                    .await?;
                if shared.is_some() {
                    storage.copy(&f.storage_path, &new_sp).await?;
                } else {
                    storage.mv(&f.storage_path, &new_sp).await?;
                }
            } else if storage.exists(&new_sp).await? {
                // Bytes already sit at the destination — a prior interrupted run
                // moved them before it could update the row. Just fix the pointer.
                tracing::warn!(
                    file = %f.id, to = %new_sp,
                    "reconcile_folder_paths: octets déjà à la cible, mise à jour DB seule"
                );
            } else {
                // Bytes are at neither location: the file is already broken.
                // Leave its stored path as a forensic trail rather than repoint
                // it at an empty location, and log for a human to look at.
                tracing::error!(
                    file = %f.id, from = %f.storage_path, to = %new_sp,
                    "reconcile_folder_paths: octets introuvables, fichier ignoré"
                );
                continue;
            }
            file_updates.push((f.id, new_sp));
        }

        // Phase 2: one atomic transaction. The FOLDER row is updated FIRST so it
        // receives a LOWER `change_seq` than its files: a sync client that
        // resolves a file's local path through its folder MUST learn the folder's
        // new path no later than the files themselves, otherwise a page boundary
        // could deliver the files (still resolving the old path) before the
        // folder move. Atomicity also restores crash-safety that the folder-first
        // order would otherwise lose: nothing commits until the whole folder is
        // done, so an interrupted run leaves the folder stale and simply retries.
        // The folder takes a fresh change_seq FIRST (lower value), then each
        // file — the delta trigger used to do this; now it is explicit. A client
        // resolving a file's local path through its folder must learn the
        // folder's new path no later than the files themselves.
        let mut tx = db.begin().await?;
        let fseq = sync::next_seq(&mut tx).await?;
        tx.execute(
            "UPDATE drive.folders SET path = $1, change_seq = $2 WHERE id = $3",
            params![&canonical, fseq, row.id],
        )
        .await?;
        for (file_id, new_sp) in &file_updates {
            let s = sync::next_seq(&mut tx).await?;
            tx.execute(
                "UPDATE drive.files SET storage_path = $1, change_seq = $2 WHERE id = $3",
                params![new_sp, s, file_id],
            )
            .await?;
        }
        tx.commit().await?;

        tracing::warn!(
            folder = %row.id, owner = %row.owner_id,
            from = %row.path, to = %canonical,
            "reconcile_folder_paths: chemin de dossier corrigé"
        );
        vacated.push((row.owner_id, row.path.clone()));
        corrected.insert(row.id, canonical);
        fixed += 1;
    }

    // Re-emit the VICTIMS of any collision we just undid. The bug at hand is two
    // folders sharing one local path; a sync client that had materialised that
    // collision resolved both folder_ids to the SAME local path, and when it
    // moved our folder's files to their corrected path it deleted the shared
    // local copy — dropping the innocent sibling's files with it. Repathing and
    // re-emitting only the offending folder does not bring those back: the
    // sibling still sitting at the vacated path must be re-emitted too, so
    // clients re-materialise it. A no-op UPDATE bumps change_seq through the
    // existing trigger; folders are touched before their files (lower seq), and
    // only the topmost vacated paths are processed since nested ones are covered.
    for (owner, vacated_path) in &vacated {
        let is_topmost = !vacated.iter().any(|(other_owner, other_path)| {
            other_owner == owner
                && other_path != vacated_path
                && vacated_path.starts_with(&format!("{other_path}/"))
        });
        if !is_topmost {
            continue;
        }
        let subtree = format!("{vacated_path}/%");
        // Our own repathed folders have already moved elsewhere, so whatever
        // still matches the vacated path is exactly the innocent sibling(s).
        // Re-emitting them = a fresh change_seq (the old no-op `SET path = path`
        // fired the trigger; without triggers the seq is assigned explicitly).
        // One seq for the folders, a later one for their files (folders first).
        let fseq = sync::next_seq_on_pool(db).await?;
        let folders_touched = db
            .execute(
                "UPDATE drive.folders SET change_seq = $1
                 WHERE owner_id = $2 AND (path = $3 OR path LIKE $4)",
                params![fseq, owner, vacated_path, &subtree],
            )
            .await?;
        if folders_touched == 0 {
            // No sibling occupied the vacated path — nothing to restore.
            continue;
        }
        let xseq = sync::next_seq_on_pool(db).await?;
        db.execute(
            "UPDATE drive.files SET change_seq = $1
             WHERE owner_id = $2 AND folder_id IN (
                 SELECT id FROM drive.folders
                 WHERE owner_id = $3 AND (path = $4 OR path LIKE $5)
             )",
            params![xseq, owner, owner, vacated_path, &subtree],
        )
        .await?;
        tracing::warn!(
            owner = %owner, path = %vacated_path, folders = folders_touched,
            "reconcile_folder_paths: sous-arbre victime ré-émis pour re-matérialisation client"
        );
    }

    Ok(fixed)
}
