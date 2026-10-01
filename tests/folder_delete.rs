//! Permanent folder deletion must keep the database and the storage consistent:
//! never a live `drive.files` / `drive.file_versions` row whose bytes were
//! removed, and never the bytes of an item outside the deleted subtree.
//!
//! Runs the real services against a throwaway SQLite database (a temp file, the
//! same harness as `db_portability`) and a `LocalStorage` rooted in a temp
//! directory. Nothing touches a shared or development database.

use std::sync::Arc;

use bytes::Bytes;
use kubuno_db::{new_id, params, DbPool};
use kubuno_drive::models::{CreateFolderDto, MoveFolderDto};
use kubuno_drive::services::{files, folders};
use kubuno_drive::{sync, SCHEMA};
use kubuno_storage::{path as storage_path, LocalStorage, StorageBackend};
use uuid::Uuid;

const MAX: u64 = 1 << 20;

struct Env {
    db: DbPool,
    storage: Arc<dyn StorageBackend>,
    owner: Uuid,
    _dirs: (tempfile::TempDir, tempfile::TempDir),
}

async fn env() -> Env {
    let db_dir = tempfile::tempdir().expect("db tempdir");
    let store_dir = tempfile::tempdir().expect("storage tempdir");
    let settings = kubuno_db::DbSettings {
        engine: "sqlite".into(),
        url: None,
        host: None,
        port: None,
        user: None,
        password: None,
        database: None,
        path: Some(db_dir.path().to_string_lossy().into_owned()),
        max_connections: 4,
        min_connections: 0,
        connect_timeout: std::time::Duration::from_secs(10),
        run_migrations: true,
        schema_prefix: None,
    };
    let db = kubuno_db::connect(&settings, SCHEMA).await.expect("connect");
    kubuno_db::migrations!("./migrations/postgres", "./migrations/mysql", "./migrations/sqlite",)
        .run(&db, SCHEMA)
        .await
        .expect("migrations");
    // Hand LocalStorage the canonical spelling of its root: kubuno-storage 0.1.1
    // compares every candidate with the canonicalized base (verbatim `\\?\` on
    // Windows), so a raw temp path would reject every operation there.
    let root = store_dir.path().canonicalize().expect("canonical storage root");
    let storage: Arc<dyn StorageBackend> =
        Arc::new(LocalStorage::new(&root.to_string_lossy()).await.expect("local storage"));
    Env { db, storage, owner: Uuid::new_v4(), _dirs: (db_dir, store_dir) }
}

impl Env {
    async fn folder(&self, name: &str, parent: Option<Uuid>) -> Uuid {
        folders::create_folder(
            &self.db,
            &self.storage,
            self.owner,
            CreateFolderDto { name: name.into(), parent_id: parent, id: None },
        )
        .await
        .expect("create folder")
        .id
    }

    async fn upload(&self, folder: Option<Uuid>, name: &str, body: &'static str) -> kubuno_drive::models::File {
        files::upload_simple(&self.db, &self.storage, self.owner, folder, name, Bytes::from(body), MAX, false)
            .await
            .expect("upload")
    }

    async fn exists(&self, path: &str) -> bool {
        self.storage.exists(path).await.expect("exists")
    }

    async fn row(&self, id: Uuid) -> Option<kubuno_drive::models::File> {
        self.db
            .fetch_optional_as::<kubuno_drive::models::File>(
                "SELECT * FROM drive.files WHERE id = $1",
                params![id],
            )
            .await
            .expect("select file")
    }

    /// Every live file / version row of the owner must still have its bytes.
    async fn assert_no_dangling_rows(&self) {
        #[derive(sqlx::FromRow)]
        struct Sp {
            storage_path: String,
        }
        let rows = self
            .db
            .fetch_all_as::<Sp>(
                "SELECT storage_path FROM drive.files WHERE owner_id = $1
                 UNION ALL
                 SELECT storage_path FROM drive.file_versions WHERE owner_id = $2",
                params![self.owner, self.owner],
            )
            .await
            .expect("select paths");
        for r in rows {
            assert!(self.exists(&r.storage_path).await, "live row points at missing bytes: {}", r.storage_path);
        }
    }

    async fn insert_version(&self, file_id: Uuid, name: &str, body: &'static str) -> String {
        let sp = storage_path::user_version_path(self.owner, file_id, 1, name).to_string_lossy().into_owned();
        self.storage.put(&sp, Bytes::from(body)).await.expect("put version");
        self.db
            .execute(
                "INSERT INTO drive.file_versions (id, file_id, owner_id, version_number, storage_path, size_bytes)
                 VALUES ($1, $2, $3, $4, $5, $6)",
                params![new_id(), file_id, self.owner, 1i32, &sp, body.len() as i64],
            )
            .await
            .expect("insert version");
        sp
    }

    async fn is_tombstoned(&self, id: Uuid) -> bool {
        let feed = kubuno_db::journal::changes_since(
            &self.db, "drive.files", sync::TOMBSTONES_TABLE, self.owner, 0, 10_000,
        )
        .await
        .expect("feed");
        feed.iter().any(|c| c.id == id && c.deleted)
    }
}

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

/// A live file re-using the name of a trashed one in the same folder ends up on
/// the same storage path. Emptying the trash, or deleting the trashed twin for
/// good, must not take the live file's bytes.
#[tokio::test]
async fn purging_a_trashed_twin_keeps_the_live_files_bytes() {
    let e = env().await;
    let old = e.upload(None, "a.txt", "old").await;
    files::trash_file(&e.db, e.owner, old.id).await.expect("trash");
    let live = e.upload(None, "a.txt", "new").await;
    assert_eq!(old.storage_path, live.storage_path, "precondition: both rows share one blob");

    files::delete_file_permanently(&e.db, &e.storage, e.owner, old.id).await.expect("delete twin");
    assert!(e.exists(&live.storage_path).await, "delete_file_permanently kept the live bytes");

    let old2 = e.upload(None, "b.txt", "old").await;
    files::trash_file(&e.db, e.owner, old2.id).await.expect("trash");
    let live2 = e.upload(None, "b.txt", "new").await;
    folders::purge_trash(&e.db, &e.storage, e.owner).await.expect("purge");
    assert!(e.exists(&live2.storage_path).await, "purge_trash kept the live bytes");
    e.assert_no_dangling_rows().await;
}
