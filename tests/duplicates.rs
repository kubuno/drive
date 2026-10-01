//! One live file per name and folder: concurrent writes and the disk scanner
//! must not leave two live rows with the same owner, folder and name, and the
//! duplicates already in a database are recorded by the migration and merged
//! into the row they duplicate without losing a byte.
//!
//! Harness: `tests/common` (temp SQLite + temp `LocalStorage`).

mod common;

use bytes::Bytes;
use common::{env, Env, MAX};
use kubuno_db::{new_id, params};
use kubuno_drive::services::{duplicates, files, scanner};
use uuid::Uuid;

#[derive(sqlx::FromRow)]
struct IdOnly {
    #[allow(dead_code)]
    id: Uuid,
}

async fn live_named(e: &Env, name: &str) -> Vec<IdOnly> {
    e.db.fetch_all_as::<IdOnly>(
        "SELECT id FROM drive.files WHERE owner_id = $1 AND name = $2 AND is_trashed = FALSE",
        params![e.owner, name],
    )
    .await
    .expect("select")
}

/// Several module saves of a NEW draft racing each other (overwrite=true, as the
/// office drafts do): exactly one live row may come out of it.
#[tokio::test]
async fn racing_overwrite_saves_leave_one_live_row() {
    let e = env().await;
    let saves = (0..4).map(|i| {
        files::create_with_bytes(
            &e.db, &e.storage, e.owner, None, "draft.json", "application/json",
            Bytes::from(format!("v{i}")), None, true,
        )
    });
    for r in futures::future::join_all(saves).await {
        r.expect("save");
    }
    assert_eq!(live_named(&e, "draft.json").await.len(), 1, "one live row per name");
    e.assert_no_dangling_rows().await;
    e.assert_no_shared_blobs().await;
}

/// Plain uploads of the same name racing each other: every file is kept, under
/// distinct names.
#[tokio::test]
async fn racing_uploads_get_distinct_names() {
    let e = env().await;
    let ups = (0..4).map(|i| {
        files::upload_simple(&e.db, &e.storage, e.owner, None, "a.txt", Bytes::from(format!("u{i}")), MAX, false)
    });
    let mut names: Vec<String> = Vec::new();
    for r in futures::future::join_all(ups).await {
        names.push(r.expect("upload").name);
    }
    names.sort();
    names.dedup();
    assert_eq!(names.len(), 4, "four files, four names: {names:?}");
    e.assert_no_dangling_rows().await;
    e.assert_no_shared_blobs().await;
}

/// The disk scanner must not register a second live file under a name a live
/// file of that folder already has.
#[tokio::test]
async fn scanner_does_not_duplicate_a_live_name() {
    let e = env().await;
    e.upload(None, "a.txt", "live").await;
    // Bytes on disk the database does not know, under a hidden directory whose
    // files the scanner attributes to the root.
    let stray = kubuno_storage::path::user_file_path(e.owner, "/.cache", "a.txt").to_string_lossy().into_owned();
    e.storage.put(&stray, Bytes::from_static(b"stray")).await.expect("stray");

    // The scan's LAST step (trashing rows missing from disk) fails on every
    // engine with a pre-existing SQL error (`NOT IN` + `push_in` renders
    // `NOT IN IN (...)`), after the inserts this test is about. Not fixed here:
    // it would switch on a path that trashes rows whose stored path is spelled
    // differently from the disk walk (the Windows `\` vs `/` issue).
    let _ = scanner::scan_owner(&e.db, &e.root, e.owner).await;
    assert_eq!(live_named(&e, "a.txt").await.len(), 1);
}


/// Inserts a live row directly, bypassing every check (what the races did).
async fn raw_live_row(e: &Env, name: &str, storage_path: &str, size: i64, updated_at: &str) -> Uuid {
    let id = new_id();
    e.db.execute(
        "INSERT INTO drive.files (id, owner_id, folder_id, name, mime_type, size_bytes, storage_path, metadata, change_seq, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        params![
            id, e.owner, None::<Uuid>, name, "application/octet-stream", size, storage_path,
            serde_json::json!({}), 0i64, updated_at, updated_at
        ],
    )
    .await
    .expect("raw insert");
    files::update_used_bytes(&e.db, e.owner, size).await;
    id
}

/// Runs the SQLite `live_name_unique` migration again, statement by statement.
async fn rerun_dedupe_migration(e: &Env) {
    let sql = std::fs::read_to_string("migrations/sqlite/000002_drive_live_name_unique.up.sql").expect("migration");
    let body: String = sql.lines().filter(|l| !l.trim_start().starts_with("--")).collect::<Vec<_>>().join("\n");
    for stmt in body.split(';').map(str::trim).filter(|s| !s.is_empty()) {
        e.db.execute(stmt, params![]).await.unwrap_or_else(|err| panic!("{stmt}: {err}"));
    }
}

#[derive(sqlx::FromRow)]
struct VersionRow {
    storage_path: String,
}

/// Existing duplicates (written before the index existed): the migration keeps
/// the newest row, records and trashes the others; the merge moves their
/// versions, star, activity and distinct contents to the keeper and only then
/// removes them — no byte is deleted, the quota stays exact.
#[tokio::test]
async fn existing_duplicates_are_recorded_then_merged_without_losing_bytes() {
    let e = env().await;
    e.db.execute("DROP INDEX drive.files_live_name_unique", params![]).await.expect("drop index");

    // Group 1: distinct contents. The older row has a version, a star, activity.
    let old = e.upload(None, "doc.kbdoc", "old").await; // 3
    let vpath = e.insert_version(old.id, "doc.kbdoc", "vv").await; // 2
    files::toggle_star_file(&e.db, e.owner, old.id).await.expect("star");
    kubuno_drive::services::activity::log_file(&e.db, old.id, e.owner, "u@x", "edited", serde_json::json!({})).await;
    let newer_path = kubuno_storage::path::user_file_path(e.owner, "", "doc-new.bin").to_string_lossy().into_owned();
    e.storage.put(&newer_path, Bytes::from_static(b"newer")).await.expect("put");
    let newer = raw_live_row(&e, "doc.kbdoc", &newer_path, 5, "2999-01-01 00:00:00.000").await; // 5

    // Group 2: two rows over ONE blob (the shape found in production).
    let a = e.upload(None, "same.json", "abcd").await; // 4
    let b = raw_live_row(&e, "same.json", &a.storage_path, 4, "2999-01-01 00:00:00.000").await; // 4 (row-counted)
    assert_eq!(e.used_bytes().await, 18);

    rerun_dedupe_migration(&e).await;

    assert!(e.row(old.id).await.expect("old").is_trashed, "older row recorded and trashed");
    assert!(!e.row(newer).await.expect("newer").is_trashed, "newest row kept live");
    assert!(e.row(a.id).await.expect("a").is_trashed);
    assert!(!e.row(b).await.expect("b").is_trashed);

    // Dry run first: the plan, nothing changed.
    let plan = duplicates::plan(&e.db, &e.storage, Some(e.owner)).await.expect("plan");
    assert_eq!(plan.len(), 2);
    let p_old = plan.iter().find(|p| p.duplicate_id == old.id).expect("plan old");
    assert_eq!(p_old.contents, Some(duplicates::Contents::KeptAsVersion));
    assert_eq!(p_old.versions_moved, 1);
    let p_a = plan.iter().find(|p| p.duplicate_id == a.id).expect("plan a");
    assert_eq!(p_a.contents, Some(duplicates::Contents::Shared));
    assert!(e.row(old.id).await.is_some());

    let outcome = duplicates::merge_all(&e.db, &e.storage, Some(e.owner)).await.expect("merge");
    assert!(outcome.errors.is_empty(), "{:?}", outcome.errors);
    assert_eq!(outcome.merged.len(), 2);

    assert!(e.row(old.id).await.is_none() && e.row(a.id).await.is_none(), "duplicates removed");
    assert!(e.is_tombstoned(old.id).await && e.is_tombstoned(a.id).await);
    let keeper = e.row(newer).await.expect("keeper");
    assert!(keeper.is_starred, "the star moved to the keeper");
    let versions = e
        .db
        .fetch_all_as::<VersionRow>(
            "SELECT storage_path FROM drive.file_versions WHERE file_id = $1 ORDER BY version_number",
            params![newer],
        )
        .await
        .expect("versions");
    assert_eq!(versions.len(), 2, "moved version + the duplicate's contents");
    assert_eq!(versions[0].storage_path, vpath);
    assert_eq!(versions[1].storage_path, old.storage_path);
    assert_eq!(e.read(&old.storage_path).await, "old", "duplicate's bytes kept as a version");
    assert_eq!(e.read(&vpath).await, "vv");
    let moved_activity: i64 = e
        .db
        .fetch_scalar("SELECT COUNT(*) FROM drive.activity_log WHERE file_id = $1", params![newer])
        .await
        .expect("activity");
    assert_eq!(moved_activity, 1);
    assert_eq!(e.read(&a.storage_path).await, "abcd", "the shared blob stays with its keeper");
    // Distinct contents: charge moved file -> version. Shared blob: one row's
    // charge released.
    assert_eq!(e.used_bytes().await, 14);
    e.assert_no_dangling_rows().await;
    e.assert_no_shared_blobs().await;

    // Idempotent: nothing left to do.
    let again = duplicates::merge_all(&e.db, &e.storage, Some(e.owner)).await.expect("merge again");
    assert!(again.merged.is_empty());
}
