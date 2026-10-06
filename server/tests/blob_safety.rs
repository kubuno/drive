//! Storage-location safety: no write path may hand a new file (or a renamed,
//! moved, copied or restored one) a location another row still references; the
//! permanent-delete paths remove version blobs and charge the quota back exactly
//! once; `drive:fsck` finds rows without bytes and shared blobs, and repairs only
//! when asked.
//!
//! Harness: `tests/common` (temp SQLite + temp `LocalStorage`).

mod common;

use bytes::Bytes;
use common::{env, MAX};
use kubuno_db::params;
use kubuno_drive::models::{MoveFileDto, RenameFileDto, RenameFolderDto};
use kubuno_drive::services::{files, folders, fsck, maintenance};

// ── 1. Locations never shared ────────────────────────────────────────────────

/// Upload `a.txt`, trash it, upload `a.txt` again: the second upload must not
/// overwrite the trashed file's bytes.
#[tokio::test]
async fn reupload_over_a_trashed_name_keeps_both_contents() {
    let e = env().await;
    let old = e.upload(None, "a.txt", "old").await;
    files::trash_file(&e.db, e.owner, old.id).await.expect("trash");
    let new = e.upload(None, "a.txt", "new").await;

    assert_eq!(new.name, "a.txt", "the display name is still free among live files");
    assert_ne!(old.storage_path, new.storage_path, "distinct locations");
    assert_eq!(e.read(&old.storage_path).await, "old", "trashed content intact");
    assert_eq!(e.read(&new.storage_path).await, "new");
    e.assert_no_shared_blobs().await;
}

/// The same through the module write path (`create_with_bytes`) and the
/// overwrite of a live file whose blob is shared with a trashed twin.
#[tokio::test]
async fn module_writes_and_overwrites_never_touch_another_rows_bytes() {
    let e = env().await;
    let old = e.upload(None, "doc.kbdoc", "old").await;
    files::trash_file(&e.db, e.owner, old.id).await.expect("trash");
    let created = files::create_with_bytes(
        &e.db, &e.storage, e.owner, None, "doc.kbdoc", "application/json", Bytes::from_static(b"new"), None, false,
    )
    .await
    .expect("create");
    assert_ne!(created.storage_path, old.storage_path);
    assert_eq!(e.read(&old.storage_path).await, "old");

    // Legacy data: the trashed twin shares the live file's blob. Overwriting the
    // live file must give it a new location, not rewrite the twin's bytes.
    e.make_legacy_twin(old.id, &created.storage_path).await;
    let over = files::upload_simple(&e.db, &e.storage, e.owner, None, "doc.kbdoc", Bytes::from_static(b"v2"), MAX, true)
        .await
        .expect("overwrite");
    assert_eq!(over.id, created.id, "overwrite updates the row in place");
    assert_ne!(over.storage_path, created.storage_path, "but writes elsewhere");
    assert_eq!(e.read(&created.storage_path).await, "new", "the twin keeps its bytes");
    assert_eq!(e.read(&over.storage_path).await, "v2");
    e.assert_no_dangling_rows().await;
}

/// Renaming onto the name of a trashed file of the same folder.
#[tokio::test]
async fn rename_onto_a_trashed_name_keeps_both_contents() {
    let e = env().await;
    let trashed = e.upload(None, "c.txt", "trashed").await;
    files::trash_file(&e.db, e.owner, trashed.id).await.expect("trash");
    let b = e.upload(None, "b.txt", "b").await;

    let renamed = files::rename_file(
        &e.db, &e.storage, e.owner, b.id, RenameFileDto { name: "c.txt".into(), overwrite: false, strict: false },
    )
    .await
    .expect("rename");
    assert_eq!(renamed.name, "c.txt");
    assert_ne!(renamed.storage_path, trashed.storage_path);
    assert_eq!(e.read(&trashed.storage_path).await, "trashed");
    assert_eq!(e.read(&renamed.storage_path).await, "b");
    e.assert_no_shared_blobs().await;
}

/// A rename must not be able to climb out of its folder.
#[tokio::test]
async fn rename_rejects_path_separators() {
    let e = env().await;
    let f = e.upload(None, "x.txt", "x").await;
    for bad in ["../../evil.txt", r"..\..\evil.txt", "a/b.txt", ".."] {
        let r = files::rename_file(
            &e.db, &e.storage, e.owner, f.id, RenameFileDto { name: bad.into(), overwrite: false, strict: false },
        )
        .await;
        assert!(r.is_err(), "{bad:?} must be refused");
    }
    assert_eq!(e.read(&f.storage_path).await, "x");
}

/// Moving into a folder holding a trashed file of the same name; copying there.
#[tokio::test]
async fn move_and_copy_onto_a_trashed_name_keep_all_contents() {
    let e = env().await;
    let dir = e.folder("F", None).await;
    let trashed = e.upload(Some(dir), "x.txt", "trashed").await;
    files::trash_file(&e.db, e.owner, trashed.id).await.expect("trash");
    let live = e.upload(None, "x.txt", "live").await;

    let moved = files::move_file(
        &e.db, &e.storage, e.owner, live.id, MoveFileDto { folder_id: Some(dir), overwrite: false, strict: false },
    )
    .await
    .expect("move");
    assert_ne!(moved.storage_path, trashed.storage_path);
    assert_eq!(e.read(&trashed.storage_path).await, "trashed");
    assert_eq!(e.read(&moved.storage_path).await, "live");

    let other = e.upload(None, "y.txt", "y").await;
    let t2 = e.upload(Some(dir), "y.txt", "t2").await;
    files::trash_file(&e.db, e.owner, t2.id).await.expect("trash");
    let copy = files::copy_file(&e.db, &e.storage, e.owner, other.id, Some(dir)).await.expect("copy");
    assert_ne!(copy.storage_path, t2.storage_path);
    assert_eq!(e.read(&t2.storage_path).await, "t2");
    assert_eq!(e.read(&copy.storage_path).await, "y");
    e.assert_no_shared_blobs().await;
}

/// Restoring a trashed file whose name a live file took meanwhile: it comes back
/// under a unique name, with its own bytes.
#[tokio::test]
async fn restore_onto_a_taken_name_picks_a_unique_name() {
    let e = env().await;
    let old = e.upload(None, "a.txt", "old").await;
    files::trash_file(&e.db, e.owner, old.id).await.expect("trash");
    let live = e.upload(None, "a.txt", "new").await;

    let restored = files::restore_file(&e.db, &e.storage, e.owner, old.id).await.expect("restore");
    assert!(!restored.is_trashed);
    assert_eq!(restored.name, "a (2).txt");
    assert_eq!(e.read(&restored.storage_path).await, "old");
    assert_eq!(e.read(&live.storage_path).await, "new");
    e.assert_no_shared_blobs().await;
    e.assert_no_dangling_rows().await;

    // Nothing to resolve: the name is simply kept.
    let solo = e.upload(None, "solo.txt", "s").await;
    files::trash_file(&e.db, e.owner, solo.id).await.expect("trash");
    let back = files::restore_file(&e.db, &e.storage, e.owner, solo.id).await.expect("restore");
    assert_eq!((back.name.as_str(), back.storage_path.as_str()), ("solo.txt", solo.storage_path.as_str()));
}

/// A legacy shared blob: renaming the live row copies, so the twin keeps bytes.
#[tokio::test]
async fn relocating_a_shared_legacy_blob_copies_it() {
    let e = env().await;
    let twin = e.upload(None, "t.txt", "same").await;
    files::trash_file(&e.db, e.owner, twin.id).await.expect("trash");
    let live = e.upload(None, "l.txt", "same").await;
    e.make_legacy_twin(twin.id, &live.storage_path).await;

    files::rename_file(
        &e.db, &e.storage, e.owner, live.id, RenameFileDto { name: "renamed.txt".into(), overwrite: false, strict: false },
    )
    .await
    .expect("rename");
    e.assert_no_dangling_rows().await;
}

/// A folder rename follows the bytes, not the display names: a file stored
/// under a numbered on-disk name keeps pointing at its own bytes.
#[tokio::test]
async fn folder_rename_follows_the_actual_locations() {
    let e = env().await;
    let dir = e.folder("Docs", None).await;
    let old = e.upload(Some(dir), "a.txt", "old").await;
    files::trash_file(&e.db, e.owner, old.id).await.expect("trash");
    let new = e.upload(Some(dir), "a.txt", "new").await;

    folders::rename_folder(
        &e.db, &e.storage, e.owner, dir, RenameFolderDto { name: "Archive".into(), overwrite: false, strict: false },
    )
    .await
    .expect("rename folder");

    let old_row = e.row(old.id).await.expect("old row");
    let new_row = e.row(new.id).await.expect("new row");
    assert_eq!(e.read(&old_row.storage_path).await, "old");
    assert_eq!(e.read(&new_row.storage_path).await, "new");
    e.assert_no_shared_blobs().await;
    e.assert_no_dangling_rows().await;
}

/// A folder name must not carry a Windows separator either.
#[tokio::test]
async fn folder_names_reject_backslashes() {
    let e = env().await;
    let r = folders::create_folder(
        &e.db,
        &e.storage,
        e.owner,
        kubuno_drive::models::CreateFolderDto { name: r"..\..\evil".into(), parent_id: None, id: None },
    )
    .await;
    assert!(r.is_err());
}

// ── 2–3. Permanent deletes: version blobs and quota, exactly once ────────────

#[tokio::test]
async fn purge_trash_removes_version_blobs_and_charges_back_once() {
    let e = env().await;
    let keep = e.upload(None, "keep.txt", "0123456789").await; // 10
    let a = e.upload(None, "a.txt", "aaa").await; // 3
    let vpath = e.insert_version(a.id, "a.txt", "vv").await; // 2
    assert_eq!(e.used_bytes().await, 15);

    files::trash_file(&e.db, e.owner, a.id).await.expect("trash");
    folders::purge_trash(&e.db, &e.storage, e.owner).await.expect("purge");

    assert!(!e.exists(&vpath).await, "version blob removed");
    assert!(!e.exists(&a.storage_path).await);
    assert_eq!(e.used_bytes().await, 10, "file + version charged back exactly once");
    assert!(e.row(keep.id).await.is_some());
}

#[tokio::test]
async fn delete_file_permanently_charges_back_file_and_versions_once() {
    let e = env().await;
    e.upload(None, "keep.txt", "0123456789").await;
    let a = e.upload(None, "a.txt", "aaa").await;
    let vpath = e.insert_version(a.id, "a.txt", "vv").await;
    assert_eq!(e.used_bytes().await, 15);

    files::delete_file_permanently(&e.db, &e.storage, e.owner, a.id).await.expect("delete");
    assert_eq!(e.used_bytes().await, 10);
    assert!(!e.exists(&vpath).await);
    assert!(e.is_tombstoned(a.id).await);
}

#[tokio::test]
async fn delete_folder_charges_back_once() {
    let e = env().await;
    e.upload(None, "keep.txt", "0123456789").await;
    let dir = e.folder("D", None).await;
    let a = e.upload(Some(dir), "a.txt", "aaa").await;
    e.insert_version(a.id, "a.txt", "vv").await;
    let t = e.upload(Some(dir), "t.txt", "tttt").await;
    files::trash_file(&e.db, e.owner, t.id).await.expect("trash");
    assert_eq!(e.used_bytes().await, 19);

    folders::delete_folder(&e.db, &e.storage, e.owner, dir).await.expect("delete folder");
    assert_eq!(e.used_bytes().await, 10);
}

#[tokio::test]
async fn trash_auto_purge_removes_versions_and_charges_back_once() {
    let e = env().await;
    e.upload(None, "keep.txt", "0123456789").await;
    let a = e.upload(None, "a.txt", "aaa").await;
    let vpath = e.insert_version(a.id, "a.txt", "vv").await;
    files::trash_file(&e.db, e.owner, a.id).await.expect("trash");
    e.db
        .execute(
            "UPDATE drive.files SET trashed_at = $1 WHERE id = $2",
            params![chrono::Utc::now() - chrono::Duration::days(60), a.id],
        )
        .await
        .expect("age");

    let n = maintenance::purge_old_files(&e.db, &e.storage, 30).await;
    assert_eq!(n, 1);
    assert!(!e.exists(&vpath).await, "version blob removed");
    assert!(!e.exists(&a.storage_path).await);
    assert_eq!(e.used_bytes().await, 10);
    assert!(e.is_tombstoned(a.id).await);
}

// ── 4. drive:fsck ────────────────────────────────────────────────────────────

#[tokio::test]
async fn fsck_reports_damage_and_repairs_only_when_asked() {
    let e = env().await;
    // A row whose bytes are gone.
    let broken = e.upload(None, "broken.txt", "b").await;
    e.storage.delete(&broken.storage_path).await.expect("lose bytes");
    // Two rows sharing one blob (legacy).
    let twin = e.upload(None, "t.txt", "shared").await;
    files::trash_file(&e.db, e.owner, twin.id).await.expect("trash");
    let live = e.upload(None, "l.txt", "shared").await;
    e.make_legacy_twin(twin.id, &live.storage_path).await;

    let opts = fsck::FsckOptions { owner: Some(e.owner), ..Default::default() };
    let report = fsck::run(&e.db, &e.storage, &opts).await.expect("fsck");
    assert!(report.dry_run);
    assert_eq!(report.missing.len(), 1);
    assert_eq!(report.missing[0].id, broken.id);
    assert_eq!(report.shared.len(), 1);
    assert_eq!(report.shared[0].rows.len(), 2);
    // Dry run: nothing changed.
    assert!(!e.row(broken.id).await.expect("row").is_trashed);
    assert_eq!(e.row(twin.id).await.expect("row").storage_path, live.storage_path);

    let repair = fsck::FsckOptions { owner: Some(e.owner), split_shared: true, trash_missing: true, merge_duplicates: false };
    let done = fsck::run(&e.db, &e.storage, &repair).await.expect("repair");
    assert!(!done.dry_run);
    assert_eq!((done.split, done.trashed), (1, 1));
    assert!(done.repair_errors.is_empty());
    assert!(e.row(broken.id).await.expect("row").is_trashed, "moved to the trash, not deleted");
    let twin_row = e.row(twin.id).await.expect("row");
    assert_ne!(twin_row.storage_path, live.storage_path, "the trashed twin got its own copy");
    assert_eq!(e.read(&twin_row.storage_path).await, "shared");
    assert_eq!(e.read(&live.storage_path).await, "shared");

    let after = fsck::run(&e.db, &e.storage, &opts).await.expect("fsck again");
    assert!(after.shared.is_empty());
}
