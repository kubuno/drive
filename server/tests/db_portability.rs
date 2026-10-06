//! Runs the drive module's own migrations and its delta/search primitives
//! against a real server of **each** engine, from a single compiled binary — the
//! proof that the engine is a run-time choice, not a build-time one, and that the
//! two ported primitives (the change journal and the normalized full-text search)
//! behave identically on PostgreSQL, MySQL/MariaDB and SQLite.
//!
//! The file bytes live in the storage backend, not the database, so this binary
//! exercises the DATABASE layer directly — the very SQL the services issue (id +
//! change_seq generated in Rust, `name_norm`/`content_norm` from
//! `search::normalize`, tombstones on hard delete).
//!
//! * SQLite always runs (a temp file, no server).
//! * PostgreSQL runs when `KUBUNO_PG_TEST_URL` points at a throwaway database.
//! * MySQL/MariaDB runs when `KUBUNO_MYSQL_TEST_URL` does.
//!
//! ```sh
//! KUBUNO_PG_TEST_URL=postgres://kubuno_test:kubuno_test@127.0.0.1:5432/kubuno_test \
//! KUBUNO_MYSQL_TEST_URL=mysql://kubuno_test:kubuno_test@127.0.0.1:3306/drive \
//!   cargo test --test db_portability
//! ```

use kubuno_db::search::{self, Field, Query, Weight};
use kubuno_db::{journal, new_id, params};
use kubuno_drive::{sync, SCHEMA};
use uuid::Uuid;

fn base_settings(engine: &str) -> kubuno_db::DbSettings {
    kubuno_db::DbSettings {
        engine: engine.to_string(),
        url: None,
        host: None,
        port: None,
        user: None,
        password: None,
        database: None,
        path: None,
        max_connections: 4,
        min_connections: 0,
        connect_timeout: std::time::Duration::from_secs(10),
        run_migrations: true,
        schema_prefix: None,
    }
}

/// Migrations run one at a time: the PostgreSQL and MySQL suites may share a server.
static EXCLUSIVE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn migrated_pool(settings: kubuno_db::DbSettings) -> (kubuno_db::DbPool, impl Sized) {
    let guard = EXCLUSIVE.lock().await;
    let pool = kubuno_db::connect(&settings, SCHEMA).await.expect("connect");
    kubuno_db::migrations!(
        "./migrations/postgres",
        "./migrations/mysql",
        "./migrations/sqlite",
    )
    .run(&pool, SCHEMA)
    .await
    .expect("migrations");
    (pool, guard)
}

// ── Direct DB writes mirroring the services ─────────────────────────────────

async fn insert_folder(pool: &kubuno_db::DbPool, owner: Uuid, name: &str, path: &str) -> Uuid {
    let id = new_id();
    let mut tx = pool.begin().await.expect("begin");
    let seq = sync::next_seq(&mut tx).await.expect("seq");
    tx.execute(
        "INSERT INTO drive.folders (id, owner_id, parent_id, name, path, change_seq) \
         VALUES ($1, $2, $3, $4, $5, $6)",
        params![id, owner, None::<Uuid>, name, path, seq],
    )
    .await
    .expect("insert folder");
    tx.commit().await.expect("commit");
    id
}

async fn insert_file(
    pool: &kubuno_db::DbPool,
    owner: Uuid,
    folder: Option<Uuid>,
    name: &str,
    content: &str,
) -> Uuid {
    let id = new_id();
    let mut tx = pool.begin().await.expect("begin");
    let seq = sync::next_seq(&mut tx).await.expect("seq");
    tx.execute(
        "INSERT INTO drive.files \
            (id, owner_id, folder_id, name, extension, mime_type, size_bytes, storage_path, \
             content_hash, metadata, change_seq) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        params![
            id, owner, folder, name, None::<&str>, "application/octet-stream", 3i64,
            format!("{owner}/files/{name}"), None::<&str>, serde_json::json!({}), seq
        ],
    )
    .await
    .expect("insert file");
    tx.commit().await.expect("commit");
    // Mirror the indexer: a normalized search_index row.
    index_file(pool, id, owner, folder, name, content, false).await;
    id
}

async fn index_file(
    pool: &kubuno_db::DbPool,
    file_id: Uuid,
    owner: Uuid,
    folder: Option<Uuid>,
    name: &str,
    content: &str,
    trashed: bool,
) {
    let name_norm = search::normalize(name);
    let content_norm = search::normalize(content);
    pool.execute(
        "INSERT INTO drive.search_index \
            (file_id, owner_id, name, mime_type, folder_id, content_text, name_norm, content_norm, \
             embedding, embedding_dim, indexed_hash, is_trashed, phash, indexed_at) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
        params![
            file_id, owner, name, "application/octet-stream", folder, content, &name_norm,
            &content_norm, None::<serde_json::Value>, None::<i32>, None::<&str>, trashed,
            None::<i64>, chrono::Utc::now()
        ],
    )
    .await
    .expect("index file");
}

/// Re-edit a file (bumps its change_seq, as an update does).
async fn touch_file(pool: &kubuno_db::DbPool, id: Uuid) {
    let mut tx = pool.begin().await.expect("begin");
    let seq = sync::next_seq(&mut tx).await.expect("seq");
    tx.execute(
        "UPDATE drive.files SET size_bytes = $1, change_seq = $2 WHERE id = $3",
        params![9i64, seq, id],
    )
    .await
    .expect("update file");
    tx.commit().await.expect("commit");
}

/// Trash a file (a modified change carrying is_trashed=true; no tombstone).
async fn trash_file(pool: &kubuno_db::DbPool, id: Uuid) {
    let mut tx = pool.begin().await.expect("begin");
    let seq = sync::next_seq(&mut tx).await.expect("seq");
    tx.execute(
        "UPDATE drive.files SET is_trashed = $1, change_seq = $2 WHERE id = $3",
        params![true, seq, id],
    )
    .await
    .expect("trash");
    tx.commit().await.expect("commit");
}

/// Hard-delete a file (tombstone + delete, as `delete_file_permanently` does).
async fn delete_file(pool: &kubuno_db::DbPool, id: Uuid, owner: Uuid, name: &str) {
    let mut tx = pool.begin().await.expect("begin");
    let seq = sync::next_seq(&mut tx).await.expect("seq");
    tx.execute("DELETE FROM drive.files WHERE id = $1", params![id]).await.expect("delete");
    sync::record_file_tombstone(&mut tx, id, owner, name, seq).await.expect("tombstone");
    tx.commit().await.expect("commit");
}

async fn delete_folder(pool: &kubuno_db::DbPool, id: Uuid, owner: Uuid, path: &str) {
    let mut tx = pool.begin().await.expect("begin");
    let seq = sync::next_seq(&mut tx).await.expect("seq");
    tx.execute("DELETE FROM drive.folders WHERE id = $1", params![id]).await.expect("delete");
    sync::record_folder_tombstone(&mut tx, id, owner, path, seq).await.expect("tombstone");
    tx.commit().await.expect("commit");
}

async fn file_seq(pool: &kubuno_db::DbPool, id: Uuid) -> i64 {
    pool.fetch_scalar::<i64>("SELECT change_seq FROM drive.files WHERE id = $1", params![id])
        .await
        .expect("file seq")
}

#[derive(Debug, sqlx::FromRow)]
struct NameRow {
    name: String,
}

/// The exact search the module runs: `Query::build` over name_norm (A) and
/// content_norm (B), best-ranked first, excluding trashed files.
async fn search_names(pool: &kubuno_db::DbPool, owner: Uuid, query: &str) -> Vec<String> {
    let fields = [Field::new("name_norm", Weight::A), Field::new("content_norm", Weight::B)];
    let Some(s) = Query::build(query, &fields, 3) else {
        return Vec::new();
    };
    let sql = format!(
        "SELECT si.name FROM drive.search_index si JOIN drive.files f ON f.id = si.file_id \
         WHERE si.owner_id = $1 AND f.is_trashed = $2 AND {} \
         ORDER BY {} DESC, si.name ASC LIMIT ${}",
        s.where_sql, s.order_sql, s.next
    );
    let mut binds = params![owner, false];
    binds.extend(s.binds);
    binds.push(100i64.into());
    pool.fetch_all_as::<NameRow>(&sql, binds)
        .await
        .expect("search")
        .into_iter()
        .map(|r| r.name)
        .collect()
}

async fn full_suite(pool: &kubuno_db::DbPool) {
    let owner = Uuid::new_v4();

    // ── strict change_seq monotonicity across create / edit / trash ──
    let mut seqs: Vec<i64> = Vec::new();

    let f1 = insert_folder(pool, owner, "Chevaux", "/Chevaux").await;
    let a1 = insert_file(pool, owner, Some(f1), "cheval au galop", "Le cheval broute dans le pré").await;
    seqs.push(file_seq(pool, a1).await);
    let a2 = insert_file(pool, owner, None, "Recette de café", "Boire un café le matin").await;
    seqs.push(file_seq(pool, a2).await);
    let a3 = insert_file(pool, owner, None, "Résumé projet", "Le résumé du projet est prêt").await;
    seqs.push(file_seq(pool, a3).await);

    touch_file(pool, a1).await;
    seqs.push(file_seq(pool, a1).await);

    trash_file(pool, a2).await;
    seqs.push(file_seq(pool, a2).await);

    for w in seqs.windows(2) {
        assert!(w[1] > w[0], "change_seq must strictly increase: {seqs:?}");
    }

    // ── the full `File` struct must decode on every engine (metadata JSON, the
    //    timestamps and the booleans are what differ per engine) ──
    let full: kubuno_drive::models::File = pool
        .fetch_one_as::<kubuno_drive::models::File>(
            "SELECT * FROM drive.files WHERE id = $1",
            params![a1],
        )
        .await
        .expect("decode full File");
    assert_eq!(full.name, "cheval au galop");
    assert_eq!(full.folder_id, Some(f1));
    assert_eq!(full.metadata, serde_json::json!({}));
    assert!(!full.is_trashed);

    // ── the owner-scoped feed (journal::changes_since over files + tombstones) ──
    // Files and folders share one global counter, so a single feed over the files
    // table already orders correctly against the shared tombstone table.
    let files_feed = journal::changes_since(
        pool, "drive.files", sync::TOMBSTONES_TABLE, owner, 0, 10_000,
    )
    .await
    .expect("files feed");
    assert!(files_feed.iter().any(|c| c.id == a1 && !c.deleted), "a1 is a live modified row");
    assert!(files_feed.iter().any(|c| c.id == a2 && !c.deleted), "trashed a2 stays a live row");
    let feed_seqs: Vec<i64> = files_feed.iter().map(|c| c.change_seq).collect();
    let mut sorted = feed_seqs.clone();
    sorted.sort_unstable();
    assert_eq!(feed_seqs, sorted, "the feed is ordered by change_seq");

    // ── search: stemmed + deaccented, identical on every engine ──
    // 1. A plural query word finds the singular stored form (trashed a2 excluded).
    let hits = search_names(pool, owner, "chevaux").await;
    assert_eq!(hits, vec!["cheval au galop".to_owned()], "chevaux -> cheval");
    // 2. Accent folding: "resume" (no accents) finds "Résumé projet".
    let hits = search_names(pool, owner, "resume").await;
    assert_eq!(hits, vec!["Résumé projet".to_owned()], "resume -> résumé");
    // 3. A term absent everywhere returns nothing.
    assert!(search_names(pool, owner, "hélicoptère").await.is_empty());

    // ── weighting: a name hit (A) outranks a content-only hit (B) ──
    insert_file(pool, owner, None, "Le lion majestueux", "un grand félin").await;
    insert_file(pool, owner, None, "Félins divers", "le lion et le tigre").await;
    let ranked = search_names(pool, owner, "lion").await;
    assert_eq!(
        ranked,
        vec!["Le lion majestueux".to_owned(), "Félins divers".to_owned()],
        "the name hit ranks above the content-only hit"
    );

    // ── tombstone: hard-deleting a file surfaces as a tombstone in the feed ──
    let doomed = insert_file(pool, owner, None, "Éphémère", "à supprimer").await;
    delete_file(pool, doomed, owner, "Éphémère").await;
    let files_feed = journal::changes_since(
        pool, "drive.files", sync::TOMBSTONES_TABLE, owner, 0, 10_000,
    )
    .await
    .expect("files feed");
    assert!(
        files_feed.iter().any(|c| c.id == doomed && c.deleted),
        "the deleted file must appear as a tombstone"
    );
    // change_seqs are unique across the whole domain (one monotonic counter).
    let mut all_seqs: Vec<i64> = files_feed.iter().map(|c| c.change_seq).collect();
    let before = all_seqs.len();
    all_seqs.sort_unstable();
    all_seqs.dedup();
    assert_eq!(before, all_seqs.len(), "file change_seqs are unique");

    // ── a deleted folder is tombstoned too (kind='folder') ──
    let sub = insert_folder(pool, owner, "Vieux", "/Vieux").await;
    delete_folder(pool, sub, owner, "/Vieux").await;
    let folders_feed = journal::changes_since(
        pool, "drive.folders", sync::TOMBSTONES_TABLE, owner, 0, 10_000,
    )
    .await
    .expect("folders feed");
    assert!(folders_feed.iter().any(|c| c.id == sub && c.deleted), "deleted folder tombstoned");
    assert!(folders_feed.iter().any(|c| c.id == f1 && !c.deleted), "live folder f1 in feed");
}

#[tokio::test]
async fn sqlite_from_the_one_binary() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut s = base_settings("sqlite");
    s.path = Some(dir.path().to_string_lossy().into_owned());
    let (pool, _keep) = migrated_pool(s).await;
    full_suite(&pool).await;
}

#[tokio::test]
async fn postgres_from_the_one_binary() {
    let Ok(url) = std::env::var("KUBUNO_PG_TEST_URL") else {
        eprintln!("skipping: KUBUNO_PG_TEST_URL not set");
        return;
    };
    let mut s = base_settings("postgres");
    s.url = Some(url);
    let (pool, _keep) = migrated_pool(s).await;
    full_suite(&pool).await;
}

#[tokio::test]
async fn mysql_from_the_one_binary() {
    let Ok(url) = std::env::var("KUBUNO_MYSQL_TEST_URL") else {
        eprintln!("skipping: KUBUNO_MYSQL_TEST_URL not set");
        return;
    };
    let mut s = base_settings("mysql");
    s.url = Some(url);
    let (pool, _keep) = migrated_pool(s).await;
    full_suite(&pool).await;
}
