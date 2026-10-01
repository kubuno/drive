//! Permanent folder deletion must keep the database and the storage consistent:
//! never a live `drive.files` / `drive.file_versions` row whose bytes were
//! removed, and never the bytes of an item outside the deleted subtree.
//!
//! Harness: `tests/common` (temp SQLite + temp `LocalStorage`).

mod common;

use bytes::Bytes;
use common::env;
use kubuno_db::params;
use kubuno_drive::models::MoveFolderDto;
use kubuno_drive::services::{files, folders};
use kubuno_storage::path as storage_path;

/// The reported bug: the files of a deleted folder were re-parented to the root
/// in the database while the folder's directory — their bytes — was removed.
#[tokio::test]
async fn deleting_a_folder_leaves_no_row_pointing_at_removed_bytes() {
    let e = env().await;
    let docs = e.folder("Docs", None).await;
    let sub = e.folder("Sub", Some(docs)).await;
    let a = e.upload(Some(docs), "a.txt", "aaa").await;
    let b = e.upload(Some(sub), "b.txt", "bbb").await;
    let trashed = e.upload(Some(sub), "t.txt", "ttt").await;
    files::trash_file(&e.db, e.owner, trashed.id).await.expect("trash");
    let keep = e.upload(None, "root.txt", "rrr").await;

    folders::delete_folder(&e.db, &e.storage, e.owner, docs).await.expect("delete folder");

    e.assert_no_dangling_rows().await;
    // Permanent deletion of the whole subtree: rows gone, bytes gone, tombstoned.
    for f in [&a, &b, &trashed] {
        assert!(e.row(f.id).await.is_none(), "{} must be deleted with its folder", f.name);
        assert!(!e.exists(&f.storage_path).await, "{} bytes must be removed", f.name);
        assert!(e.is_tombstoned(f.id).await, "{} must surface as a tombstone", f.name);
    }
    let docs_dir = storage_path::user_folder_dir(e.owner, "/Docs");
    assert!(!e.exists(&docs_dir.to_string_lossy()).await, "the folder directory is removed");
    // Outside the subtree nothing moves.
    assert!(e.row(keep.id).await.is_some());
    assert!(e.exists(&keep.storage_path).await);
    assert!(folders::get_folder(&e.db, e.owner, sub).await.is_err(), "descendant folder removed");
}

/// Bytes under the doomed directory that a live row OUTSIDE the subtree still
/// references (a case-insensitive sibling on Windows/macOS, a path left behind by
/// an interrupted move…) must survive: the directory is not wiped blindly.
#[tokio::test]
async fn deleting_a_folder_keeps_bytes_a_live_row_still_references() {
    let e = env().await;
    let docs = e.folder("Docs", None).await;
    let doomed = e.upload(Some(docs), "a.txt", "aaa").await;
    // A live root file whose bytes sit inside the Docs directory.
    let foreign = e.upload(None, "outside.txt", "ooo").await;
    let inside = storage_path::user_file_path(e.owner, "/Docs", "outside.txt").to_string_lossy().into_owned();
    e.storage.mv(&foreign.storage_path, &inside).await.expect("relocate bytes");
    e.db
        .execute("UPDATE drive.files SET storage_path = $1 WHERE id = $2", params![&inside, foreign.id])
        .await
        .expect("repoint row");

    folders::delete_folder(&e.db, &e.storage, e.owner, docs).await.expect("delete folder");

    e.assert_no_dangling_rows().await;
    assert!(e.exists(&inside).await, "bytes of a live row must never be deleted");
    assert!(!e.exists(&doomed.storage_path).await, "the deleted file's own bytes are removed");
}

/// Versions and thumbnails of the deleted files go with them (no orphaned blob,
/// no orphaned version row).
#[tokio::test]
async fn deleting_a_folder_removes_versions_and_thumbnails() {
    let e = env().await;
    let docs = e.folder("Docs", None).await;
    let a = e.upload(Some(docs), "a.txt", "aaa").await;
    let vpath = e.insert_version(a.id, "a.txt", "old").await;
    let thumb = storage_path::user_thumbnail_path(e.owner, a.id).to_string_lossy().into_owned();
    e.storage.put(&thumb, Bytes::from_static(b"jpg")).await.expect("put thumb");
    e.db
        .execute("UPDATE drive.files SET has_thumbnail = $1 WHERE id = $2", params![true, a.id])
        .await
        .expect("flag thumb");

    folders::delete_folder(&e.db, &e.storage, e.owner, docs).await.expect("delete folder");

    assert!(!e.exists(&vpath).await, "version blob removed");
    assert!(!e.exists(&thumb).await, "thumbnail removed");
    let left = e
        .db
        .fetch_all_as::<kubuno_drive::models::FileVersion>(
            "SELECT * FROM drive.file_versions WHERE file_id = $1",
            params![a.id],
        )
        .await
        .expect("versions");
    assert!(left.is_empty(), "version rows removed");
}

/// Merging a folder into a same-named one (move with overwrite) deletes the
/// emptied source: its individually trashed files must stay restorable.
#[tokio::test]
async fn merging_folders_keeps_trashed_files_restorable() {
    let e = env().await;
    let parent = e.folder("P", None).await;
    let src = e.folder("X", Some(parent)).await;
    let _dst = e.folder("X", None).await;
    let live = e.upload(Some(src), "l.txt", "lll").await;
    let trashed = e.upload(Some(src), "t.txt", "ttt").await;
    files::trash_file(&e.db, e.owner, trashed.id).await.expect("trash");

    folders::move_folder(
        &e.db,
        &e.storage,
        e.owner,
        src,
        MoveFolderDto { parent_id: None, overwrite: true, strict: false },
    )
    .await
    .expect("merge");

    e.assert_no_dangling_rows().await;
    let t = e.row(trashed.id).await.expect("trashed file survives the merge");
    assert!(t.is_trashed, "it stays in the trash");
    assert!(e.exists(&t.storage_path).await, "with its bytes");
    assert!(e.row(live.id).await.is_some());
}

/// Rows written before storage locations were allocated can share one blob (a
/// live file re-using the name of a trashed one in the same folder). Emptying
/// the trash, or deleting the trashed twin for good, must not take the live
/// file's bytes.
#[tokio::test]
async fn purging_a_trashed_twin_keeps_the_live_files_bytes() {
    let e = env().await;
    let old = e.upload(None, "a.txt", "old").await;
    files::trash_file(&e.db, e.owner, old.id).await.expect("trash");
    let live = e.upload(None, "a.txt", "new").await;
    e.make_legacy_twin(old.id, &live.storage_path).await;

    files::delete_file_permanently(&e.db, &e.storage, e.owner, old.id).await.expect("delete twin");
    assert!(e.exists(&live.storage_path).await, "delete_file_permanently kept the live bytes");

    let old2 = e.upload(None, "b.txt", "old").await;
    files::trash_file(&e.db, e.owner, old2.id).await.expect("trash");
    let live2 = e.upload(None, "b.txt", "new").await;
    e.make_legacy_twin(old2.id, &live2.storage_path).await;
    folders::purge_trash(&e.db, &e.storage, e.owner).await.expect("purge");
    assert!(e.exists(&live2.storage_path).await, "purge_trash kept the live bytes");
    e.assert_no_dangling_rows().await;
}
