//! Shared harness of the data-safety tests: the real services against a
//! throwaway SQLite database (temp files) and a `LocalStorage` rooted in a temp
//! directory. Nothing touches a shared or development database.
//!
//! The pool holds ONE connection, on which a stand-in `core` database is
//! ATTACHed with a minimal `core.users` table, so the quota counter
//! (`core.users.used_bytes`) the services maintain can be asserted.

#![allow(dead_code)]

use std::sync::Arc;

use bytes::Bytes;
use kubuno_db::{new_id, params, DbPool};
use kubuno_drive::models::{CreateFolderDto, File};
use kubuno_drive::services::{files, folders};
use kubuno_drive::{sync, SCHEMA};
use kubuno_storage::{path as storage_path, LocalStorage, StorageBackend};
use uuid::Uuid;

pub const MAX: u64 = 1 << 20;

pub struct Env {
    pub db: DbPool,
    pub storage: Arc<dyn StorageBackend>,
    pub owner: Uuid,
    /// Canonical storage root (what the scanner walks).
    pub root: std::path::PathBuf,
    _dirs: (tempfile::TempDir, tempfile::TempDir),
}

pub async fn env() -> Env {
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
        max_connections: 1,
        min_connections: 1,
        connect_timeout: std::time::Duration::from_secs(10),
        run_migrations: true,
        schema_prefix: None,
    };
    let db = kubuno_db::connect(&settings, SCHEMA).await.expect("connect");
    kubuno_db::migrations!("./migrations/postgres", "./migrations/mysql", "./migrations/sqlite",)
        .run(&db, SCHEMA)
        .await
        .expect("migrations");

    let core_file = db_dir.path().join("core-test.sqlite");
    db.execute(
        &format!("ATTACH DATABASE '{}' AS core", core_file.to_string_lossy().replace('\'', "''")),
        params![],
    )
    .await
    .expect("attach core");
    db.execute(
        "CREATE TABLE IF NOT EXISTS core.users (id BLOB PRIMARY KEY, used_bytes INTEGER NOT NULL DEFAULT 0, quota_bytes INTEGER NOT NULL DEFAULT 0)",
        params![],
    )
    .await
    .expect("core.users");
    let owner = Uuid::new_v4();
    db.execute(
        "INSERT INTO core.users (id, used_bytes, quota_bytes) VALUES ($1, $2, $3)",
        params![owner, 0i64, 1i64 << 40],
    )
    .await
    .expect("insert user");

    // Hand LocalStorage the canonical spelling of its root: kubuno-storage 0.1.1
    // compares every candidate with the canonicalized base (verbatim `\\?\` on
    // Windows), so a raw temp path would reject every operation there.
    let root = store_dir.path().canonicalize().expect("canonical storage root");
    let storage: Arc<dyn StorageBackend> =
        Arc::new(LocalStorage::new(&root.to_string_lossy()).await.expect("local storage"));
    Env { db, storage, owner, root, _dirs: (db_dir, store_dir) }
}

impl Env {
    pub async fn folder(&self, name: &str, parent: Option<Uuid>) -> Uuid {
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

    pub async fn upload(&self, folder: Option<Uuid>, name: &str, body: &'static str) -> File {
        files::upload_simple(&self.db, &self.storage, self.owner, folder, name, Bytes::from(body), MAX, false)
            .await
            .expect("upload")
    }

    pub async fn exists(&self, path: &str) -> bool {
        self.storage.exists(path).await.expect("exists")
    }

    pub async fn read(&self, path: &str) -> String {
        String::from_utf8(self.storage.get(path).await.expect("read blob").to_vec()).expect("utf8")
    }

    pub async fn row(&self, id: Uuid) -> Option<File> {
        self.db
            .fetch_optional_as::<File>("SELECT * FROM drive.files WHERE id = $1", params![id])
            .await
            .expect("select file")
    }

    pub async fn used_bytes(&self) -> i64 {
        self.db
            .fetch_scalar::<i64>("SELECT used_bytes FROM core.users WHERE id = $1", params![self.owner])
            .await
            .expect("used_bytes")
    }

    /// Every file / version row of the owner must still have its bytes.
    pub async fn assert_no_dangling_rows(&self) {
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

    /// No two rows of the owner may share one storage location.
    pub async fn assert_no_shared_blobs(&self) {
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
        let mut seen = std::collections::HashSet::new();
        for r in rows {
            let key = r.storage_path.replace('\\', "/").to_lowercase();
            assert!(seen.insert(key), "two rows share the blob {}", r.storage_path);
        }
    }

    /// A version row + blob written directly (charged like `create_version`).
    pub async fn insert_version(&self, file_id: Uuid, name: &str, body: &'static str) -> String {
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
        files::update_used_bytes(&self.db, self.owner, body.len() as i64).await;
        sp
    }

    /// Makes `twin` share `live`'s blob, as the old naming code did.
    pub async fn make_legacy_twin(&self, twin: Uuid, live_path: &str) {
        self.db
            .execute("UPDATE drive.files SET storage_path = $1 WHERE id = $2", params![live_path, twin])
            .await
            .expect("share blob");
    }

    pub async fn is_tombstoned(&self, id: Uuid) -> bool {
        let feed = kubuno_db::journal::changes_since(
            &self.db, "drive.files", sync::TOMBSTONES_TABLE, self.owner, 0, 10_000,
        )
        .await
        .expect("feed");
        feed.iter().any(|c| c.id == id && c.deleted)
    }
}
