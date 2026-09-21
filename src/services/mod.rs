use kubuno_db::dialect::Backend;

/// A null-safe equality fragment: `col = $n` when the bound value is present and
/// `col IS NULL` when it is NULL, in the local spelling. Replaces PostgreSQL's
/// `col IS NOT DISTINCT FROM $n`, which MySQL does not have. `col` is a
/// developer-authored identifier, never request data; `n` is the placeholder
/// number of the (single) bound value.
///
/// * PostgreSQL: `col IS NOT DISTINCT FROM $n`
/// * SQLite:     `col IS $n`     (SQLite's `IS` is null-safe)
/// * MySQL:      `col <=> $n`    (the null-safe equality operator)
pub(crate) fn null_safe_eq(backend: Backend, col: &str, n: usize) -> String {
    match backend {
        Backend::Postgres => format!("{col} IS NOT DISTINCT FROM ${n}"),
        Backend::Sqlite => format!("{col} IS ${n}"),
        Backend::MySql => format!("{col} <=> ${n}"),
    }
}

/// Null-safe equality between two columns/expressions (PostgreSQL's
/// `a IS NOT DISTINCT FROM b`). Both sides are developer-authored identifiers.
pub(crate) fn null_safe_eq_cols(backend: Backend, a: &str, b: &str) -> String {
    match backend {
        Backend::Postgres => format!("{a} IS NOT DISTINCT FROM {b}"),
        Backend::Sqlite => format!("{a} IS {b}"),
        Backend::MySql => format!("{a} <=> {b}"),
    }
}

/// Null-safe inequality between two columns/expressions (PostgreSQL's
/// `a IS DISTINCT FROM b`).
pub(crate) fn null_safe_distinct_cols(backend: Backend, a: &str, b: &str) -> String {
    match backend {
        Backend::Postgres => format!("{a} IS DISTINCT FROM {b}"),
        Backend::Sqlite => format!("{a} IS NOT {b}"),
        Backend::MySql => format!("NOT ({a} <=> {b})"),
    }
}

pub mod access;
pub mod activity;
pub mod archives;
pub mod comments;
pub mod embeddings;
pub mod extract;
pub mod files;
pub mod folder_reconcile;
pub mod folders;
pub mod indexer;
pub mod insights;
pub mod locks;
pub mod maintenance;
pub mod phash;
pub mod saved_searches;
pub mod scanner;
pub mod search;
pub mod shares;
pub mod sync;
pub mod system_fonts;
pub mod tags;
pub mod thumbnails;
pub mod uploads;
// Déclaration de la consommation de ce module au core (provenance du stockage).
pub mod usage;
pub mod versions;
pub mod watcher;
