//! Delta-sync plumbing shared by the services and the delta handler.
//!
//! An offline-first client pulls every change to its files and folders past a
//! cursor. That rests on a strictly monotonic `change_seq` stamped on every
//! file, folder and tombstone, and on a tombstone row per hard-deleted item. On
//! PostgreSQL that used to be a `SEQUENCE` plus `BEFORE UPDATE` / `AFTER DELETE`
//! triggers; here it is the portable [`kubuno_db::journal`] primitive, driven
//! from Rust at every write site.
//!
//! # One global domain, on purpose
//!
//! Files, folders and tombstones all draw their `change_seq` from a **single**
//! counter domain (`"drive"`), exactly as the old global `SEQUENCE` did. The
//! client merges the three sources and paginates by a single `change_seq`
//! cursor, so the sequence must be globally unique and ordered across all three
//! — a per-table counter would let a file and a folder share a number and the
//! `change_seq > cursor` filter would drop one.
//!
//! # Tombstones carry a kind and a display path
//!
//! Drive's tombstone is richer than the generic journal one (`kind` = file /
//! folder, and the deleted item's name or path for client display), so the
//! insert is written here rather than through `journal::record_tombstone`. The
//! monotonic seq still comes from the shared counter.

use kubuno_db::dialect::Assign;
use uuid::Uuid;

/// One shared counter table per schema; `next_seq` keys it by domain.
pub const CHANGE_COUNTER: &str = "drive.change_counter";
/// The single logical domain files, folders and tombstones all draw from.
pub const DRIVE_DOMAIN: &str = "drive";

pub const TOMBSTONES_TABLE: &str = "drive.tombstones";

/// The next monotonic sequence for the drive domain, taken inside `tx`.
pub async fn next_seq(tx: &mut kubuno_db::DbTx) -> Result<i64, sqlx::Error> {
    kubuno_db::journal::next_seq(tx, CHANGE_COUNTER, DRIVE_DOMAIN).await
}

/// The next monotonic sequence, wrapping its own transaction — for a lone write
/// that does not already run inside one. Prefer sharing a transaction with the
/// row write via [`next_seq`] when the write is itself transactional.
pub async fn next_seq_on_pool(pool: &kubuno_db::DbPool) -> Result<i64, sqlx::Error> {
    kubuno_db::journal::next_seq_on_pool(pool, CHANGE_COUNTER, DRIVE_DOMAIN).await
}

/// Writes a **file** tombstone (kind `file`, display path = the file name) in
/// the same transaction as the hard delete. `seq` comes from [`next_seq`] on
/// the same `tx`, so the deletion orders against every other change.
pub async fn record_file_tombstone(
    tx: &mut kubuno_db::DbTx,
    id: Uuid,
    owner_id: Uuid,
    name: &str,
    seq: i64,
) -> Result<(), sqlx::Error> {
    record_tombstone(tx, id, owner_id, "file", Some(name), seq).await
}

/// Writes a **folder** tombstone (kind `folder`, display path = the folder path)
/// in the same transaction as the hard delete.
pub async fn record_folder_tombstone(
    tx: &mut kubuno_db::DbTx,
    id: Uuid,
    owner_id: Uuid,
    path: &str,
    seq: i64,
) -> Result<(), sqlx::Error> {
    record_tombstone(tx, id, owner_id, "folder", Some(path), seq).await
}

/// The shared tombstone upsert: re-deleting an id that was recreated refreshes
/// its sequence and timestamp, matching the trigger it replaces.
async fn record_tombstone(
    tx: &mut kubuno_db::DbTx,
    id: Uuid,
    owner_id: Uuid,
    kind: &'static str,
    path: Option<&str>,
    seq: i64,
) -> Result<(), sqlx::Error> {
    // Only `Incoming` assignments, so the `upsert` table argument is never
    // interpolated — an empty `&'static str` is correct here.
    let clause = tx.backend().upsert(
        "",
        &["id"],
        &[
            Assign::Incoming("owner_id"),
            Assign::Incoming("kind"),
            Assign::Incoming("path"),
            Assign::Incoming("change_seq"),
            Assign::Incoming("deleted_at"),
        ],
    );
    let sql = format!(
        "INSERT INTO {TOMBSTONES_TABLE} (id, owner_id, kind, path, change_seq, deleted_at) \
         VALUES ($1, $2, $3, $4, $5, $6){clause}"
    );
    tx.execute(
        &sql,
        kubuno_db::params![id, owner_id, kind, path, seq, chrono::Utc::now()],
    )
    .await?;
    Ok(())
}
