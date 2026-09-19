//! Declaring to the core what this module stores, per account and per category.
//!
//! ## The attribution rule
//!
//! **Whoever physically holds the byte declares it, and nobody else.** drive
//! holds more than what its own UI wrote: office, notes, flow and the rest push
//! their documents through `/ipc/*`, and those bytes land in `drive.files` on
//! drive's disk. They are therefore drive's to declare — as `content`, exactly
//! like a file dropped in the browser — and the writing modules declare nothing
//! for them. Any other arrangement double counts the same physical byte, which
//! is precisely what the categorised channel exists to prevent.
//!
//! ## What is billed, and what is merely held
//!
//! The criterion is **what the account can free by itself**. Drive bills
//! `content`, `trash` and `versions`: each has a control in the interface — a
//! file can be deleted, the bin emptied, and versioning switched off, listed and
//! purged one revision at a time (`PATCH /:id/versioning`,
//! `DELETE /:id/versions/:vid`). Everything else — `thumbnails`, `index`,
//! `cache`, `staging`, `system` — exists because the module needs it: derived,
//! regenerable, or installed by the platform, and with no control the account
//! could use to reclaim it. It is declared, so an operator sizes the disk on the
//! whole, and not charged.
//!
//! `trash` stays a category of its own rather than folding into `content`: when
//! an account saturates, "half of it is in the bin" is the single most useful
//! thing the console can say.
//!
//! The core's vocabulary also carries `retention` (copies the module keeps by
//! policy, which the account *cannot* delete) and `delegated` (bytes another
//! module physically holds). Drive declares neither: nothing it keeps is beyond
//! the user's reach, and it holds everything it declares.
//!
//! ## Deduplication by `storage_path` — the correction this file exists for
//!
//! `drive.files` is *not* one row per physical object. Overwrites, IPC
//! re-registrations and the disk scanner all leave several rows pointing at the
//! same `storage_path`; on this instance the admin account alone carries 3227
//! rows for 3151 distinct paths, i.e. ~204 MB counted twice. A declaration is a
//! statement about bytes on a disk, so every category derived from `drive.files`
//! collapses rows by `storage_path` first and takes ONE size per path. The
//! collapsing rule also decides the category: a path is `trash` only when
//! *every* row pointing at it is trashed — one live row makes the object live,
//! and an object is never in two categories at once.
//!
//! Note that `core.users.used_bytes`, maintained incrementally by
//! [`super::files::update_used_bytes`], counts *rows* and therefore still
//! double-counts shared paths. The two figures are no longer meant to match:
//! this one is the honest measure of the disk, that one is the quota counter.
//!
//! ## State, never deltas
//!
//! Every declaration carries the module's **current total** for the
//! `(account, category)` pairs it names, so re-sending one changes nothing and a
//! message lost in flight costs one stale figure until the next declaration
//! repairs it completely. The core keys the row on
//! `(module_id, user_id, category)`; idempotence is structural.
//!
//! ## Two rhythms
//!
//! * **Incremental.** Every write path in this module funnels through
//!   [`super::files::update_used_bytes`], which marks the owner dirty. A
//!   background task coalesces the marks and declares a few seconds later — so a
//!   hundred-file upload produces one declaration, not a hundred, and the upload
//!   itself never waits on the core. Because a *partial* declaration retires
//!   nothing, a category that fell to zero has to be declared as an explicit
//!   zero; otherwise its last non-zero figure would stand forever.
//! * **Full.** At startup and every few hours, every account is recounted and
//!   declared as a complete state. This is the repair path: it corrects anything
//!   the incremental path missed while the core was unreachable, and it is the
//!   only declaration that can retire a `(account, category)` drive no longer
//!   holds anything for — there, omission *is* the retirement, so zeros are left
//!   out rather than sent.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Duration;

use kubuno_storage::{StorageBackend, StorageError};
use serde_json::json;
use sqlx::PgPool;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::state::AppState;

/// How long marks are coalesced before a declaration is sent. Long enough that a
/// bulk upload collapses into one call, short enough that the console is right
/// by the time somebody switches to it.
const FLUSH_INTERVAL: Duration = Duration::from_secs(5);

/// How often the complete state is recounted and declared.
const FULL_SYNC_INTERVAL: Duration = Duration::from_secs(6 * 3_600);

/// First retry delay when a full declaration could not be delivered, doubling up
/// to [`FULL_SYNC_INTERVAL`].
///
/// The module starts before the core has necessarily finished accepting
/// registrations, so the very first full declaration routinely fails. Without a
/// backoff it would simply be re-attempted six hours later, and the breakdown
/// would sit empty for an afternoon after every reboot.
const FULL_RETRY_MIN: Duration = Duration::from_secs(15);

/// Matches the core's own per-request ceiling (`storage::usage::MAX_ENTRIES`).
///
/// It counts **entries**, not accounts, and one account now produces up to eight
/// of them — so a page holds ~625 accounts, not 5 000. Getting this wrong would
/// not be a soft failure: the core answers 422 and the whole page is lost.
const MAX_ENTRIES: usize = 5_000;

/// Marks left by the write paths, drained by the reporter task.
///
/// A global rather than a field on `AppState` because `update_used_bytes` is a
/// free function reached from a dozen call sites with nothing but a `PgPool` —
/// threading a channel through all of them would touch every write path in the
/// module to deliver one notification.
static DIRTY: OnceLock<mpsc::UnboundedSender<Uuid>> = OnceLock::new();

/// Signals that an account's drive total has changed.
///
/// Never blocks and never fails the caller's work: a dropped mark costs one
/// stale figure until the next full sync, which is not worth failing an upload
/// over. Before the reporter task has started (or when it is disabled) this is a
/// no-op.
pub fn mark_dirty(owner_id: Uuid) {
    if let Some(tx) = DIRTY.get() {
        let _ = tx.send(owner_id);
    }
}

// ── The vocabulary ────────────────────────────────────────────────────────────

/// What a declared quantity of bytes *is*, in drive's own machinery.
///
/// Mirrors the core's closed vocabulary (`core::storage::categories::Category`).
/// A value outside it is refused with 422, so this enum — not a string literal
/// at the call site — is what keeps a typo from silently erasing a slice of the
/// breakdown.
///
/// Two of the core's ten categories are deliberately absent: `Delegated` names
/// bytes another module physically holds, and `Retention` names copies the
/// account cannot delete. Drive holds everything it declares, and keeps nothing
/// the account has no control over — so declaring either would be a lie the
/// compiler cannot catch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
enum Category {
    /// Live files the account (or a module writing on its behalf) put there.
    Content,
    /// Deleted but restorable. Billed: the bytes are still on the disk and the
    /// account can free them itself by emptying the bin.
    Trash,
    /// `drive.file_versions` — earlier revisions of a file. Billed: the account
    /// turns versioning on, and lists, restores and deletes revisions one by
    /// one. They are kept at its request and it can free them at will.
    Versions,
    /// Rendered previews under `{owner}/thumbnails/`.
    Thumbnails,
    /// `drive.search_index` — extracted text, tsvectors, embeddings.
    Index,
    /// `drive.remote_cache` — metadata memoised from remote mounts.
    Cache,
    /// Chunks of uploads still in flight.
    Staging,
    /// The `/System` tree: fonts, dictionaries, themes installed by the
    /// platform. Inside the account's tree for technical reasons only.
    System,
}

impl Category {
    /// The identifier on the wire.
    fn as_str(self) -> &'static str {
        match self {
            Category::Content => "content",
            Category::Trash => "trash",
            Category::Versions => "versions",
            Category::Thumbnails => "thumbnails",
            Category::Index => "index",
            Category::Cache => "cache",
            Category::Staging => "staging",
            Category::System => "system",
        }
    }

    /// Whether the core charges this against the account's quota — i.e. whether
    /// the account has a control that frees it.
    ///
    /// Duplicated from the core on purpose: it is what this module's own logs
    /// and tests reason about, and importing the core to learn it would break
    /// the rule that a module never links the core.
    fn is_billable(self) -> bool {
        matches!(
            self,
            Category::Content | Category::Trash | Category::Versions
        )
    }
}

/// The categories an incremental declaration always states, including at zero.
///
/// [`Category::Thumbnails`] is absent because it is only ever *measured* during
/// a full sync (see [`refresh_thumbnails`]): declaring it at zero here, from a
/// flush that never looked at the disk, would erase a real figure every five
/// seconds.
const ZERO_FILLED: &[Category] = &[
    Category::Content,
    Category::Trash,
    Category::Versions,
    Category::Index,
    Category::Cache,
    Category::Staging,
    Category::System,
];

/// One line of a declaration: what drive holds for one account under one
/// category.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Entry {
    user_id: Uuid,
    category: Category,
    used_bytes: i64,
    object_count: i64,
}

// ── Classification (pure, and therefore testable without a database) ──────────

/// One physical object, as `drive.files` describes it once the rows pointing at
/// the same `storage_path` are considered together.
#[derive(Debug, Clone, sqlx::FromRow)]
struct StoredPath {
    owner_id: Uuid,
    storage_path: String,
    /// One size for the path. Several rows describing the same object should
    /// agree; when they have drifted the largest is the safe reading, since the
    /// physical file has exactly one size and under-declaring hides a real disk.
    size_bytes: i64,
    /// True only when *every* row pointing at this path is trashed.
    all_trashed: bool,
    /// True when *any* row pointing at this path sits under `/System`.
    in_system: bool,
}

/// The one place that decides which category a physical object falls in.
///
/// Order matters: `/System` wins over everything (a trashed dictionary is still
/// not the account's doing), and `trash` only applies when nothing live points at
/// the object — an object is never in two categories, so the shares add up.
fn classify(path: &StoredPath) -> Category {
    if path.in_system {
        Category::System
    } else if path.all_trashed {
        Category::Trash
    } else {
        Category::Content
    }
}

/// Collapses rows to physical objects, then sums them per account and category.
///
/// The SQL already groups by `storage_path`, and this folds by it again. That is
/// not redundancy for its own sake: it makes the "one physical byte, one count"
/// guarantee a property of code that can be tested without a database, and it
/// holds even if a future query forgets its `GROUP BY`.
fn fold_paths(rows: &[StoredPath]) -> Vec<Entry> {
    let mut unique: HashMap<(Uuid, &str), StoredPath> = HashMap::with_capacity(rows.len());
    for row in rows {
        unique
            .entry((row.owner_id, row.storage_path.as_str()))
            .and_modify(|kept| {
                kept.size_bytes = kept.size_bytes.max(row.size_bytes);
                kept.all_trashed = kept.all_trashed && row.all_trashed;
                kept.in_system = kept.in_system || row.in_system;
            })
            .or_insert_with(|| row.clone());
    }

    let mut totals: HashMap<(Uuid, Category), (i64, i64)> = HashMap::new();
    for path in unique.values() {
        let slot = totals.entry((path.owner_id, classify(path))).or_insert((0, 0));
        slot.0 = slot.0.saturating_add(path.size_bytes);
        slot.1 += 1;
    }

    let mut entries: Vec<Entry> = totals
        .into_iter()
        .map(|((user_id, category), (used_bytes, object_count))| Entry {
            user_id,
            category,
            used_bytes,
            object_count,
        })
        .collect();
    entries.sort_by_key(|e| (e.user_id, e.category));
    entries
}

/// What the account is charged for, out of a declaration.
///
/// Logged rather than sent: the core applies the rule itself. Having drive state
/// the same figure is what makes a disagreement visible in a log instead of only
/// on an invoice.
fn billable_bytes(entries: &[Entry]) -> i64 {
    entries
        .iter()
        .filter(|e| e.category.is_billable())
        .map(|e| e.used_bytes)
        .sum()
}

// ── Counting ─────────────────────────────────────────────────────────────────

/// Reads one physical object per row from `drive.files`.
///
/// `owners = None` recounts everything (full sync); `Some(list)` restricts to the
/// accounts a flush marked dirty.
///
/// The `/System` test is a `LEFT JOIN` on the folder tree because the marker
/// lives on the folder, not the file — and it is a `LEFT` join because a file at
/// the account's root has no folder at all, which must not drop it from the
/// count. `BOOL_OR` over that nullable expression yields NULL when every row is
/// rootless, hence the `COALESCE`.
async fn stored_paths(db: &PgPool, owners: Option<&[Uuid]>) -> Result<Vec<StoredPath>, sqlx::Error> {
    let sql = format!(
        "SELECT f.owner_id,
                f.storage_path,
                MAX(f.size_bytes)::bigint                                       AS size_bytes,
                BOOL_AND(f.is_trashed)                                          AS all_trashed,
                COALESCE(BOOL_OR(fo.path = '/System' OR fo.path LIKE '/System/%'), FALSE)
                                                                                AS in_system
           FROM drive.files f
           LEFT JOIN drive.folders fo ON fo.id = f.folder_id
          {}
          GROUP BY f.owner_id, f.storage_path",
        if owners.is_some() {
            "WHERE f.owner_id = ANY($1)"
        } else {
            ""
        }
    );

    // Audited: the interpolation picks between two string literals; the owner
    // list is bound.
    let mut query = sqlx::query_as::<_, StoredPath>(sqlx::AssertSqlSafe(sql));
    if let Some(owners) = owners {
        query = query.bind(owners);
    }
    query.fetch_all(db).await.inspect_err(|e| {
        tracing::error!(error = %e, "Recomptage des objets stockés échoué");
    })
}

/// The categories the database can add up on its own, one query each.
///
/// Returns `(owner_id, used_bytes, object_count)`.
///
/// `index` and `cache` are weighed with `pg_column_size`: their cost *is* the
/// row, there is no blob behind it. `staging` multiplies chunks received by the
/// chunk size rather than reading the temporary files, which is close enough for
/// something that exists for minutes and is nobody's quota.
async fn aggregate(
    db: &PgPool,
    category: Category,
    owners: Option<&[Uuid]>,
) -> Result<Vec<(Uuid, i64, i64)>, sqlx::Error> {
    let scoped = owners.is_some();
    let sql: String = match category {
        Category::Versions => format!(
            "SELECT owner_id, COALESCE(SUM(size_bytes), 0)::bigint, COUNT(*)::bigint
               FROM drive.file_versions
              {}
              GROUP BY owner_id",
            if scoped { "WHERE owner_id = ANY($1)" } else { "" }
        ),
        Category::Index => format!(
            "SELECT si.owner_id, COALESCE(SUM(pg_column_size(si.*)), 0)::bigint, COUNT(*)::bigint
               FROM drive.search_index si
              {}
              GROUP BY si.owner_id",
            if scoped { "WHERE si.owner_id = ANY($1)" } else { "" }
        ),
        Category::Staging => format!(
            "SELECT owner_id,
                    COALESCE(SUM(chunks_received::bigint * chunk_size), 0)::bigint,
                    COUNT(*)::bigint
               FROM drive.upload_sessions
              WHERE status NOT IN ('done', 'failed')
                {}
              GROUP BY owner_id",
            if scoped { "AND owner_id = ANY($1)" } else { "" }
        ),
        // `remote_cache` carries no owner of its own; the connection it belongs
        // to does. Without that join the rows could not be attributed at all.
        Category::Cache => format!(
            "SELECT rc_conn.owner_id,
                    COALESCE(SUM(pg_column_size(rc.*)), 0)::bigint,
                    COUNT(*)::bigint
               FROM drive.remote_cache rc
               JOIN drive.remote_connections rc_conn ON rc_conn.id = rc.connection_id
              {}
              GROUP BY rc_conn.owner_id",
            if scoped {
                "WHERE rc_conn.owner_id = ANY($1)"
            } else {
                ""
            }
        ),
        // Derived from `drive.files` (see `stored_paths`) or from the storage
        // backend (see `refresh_thumbnails`), never from a plain aggregate.
        Category::Content | Category::Trash | Category::System | Category::Thumbnails => {
            return Ok(Vec::new())
        }
    };

    // Audited: same shape — the match yields literals only, the owner list is
    // bound.
    let mut query = sqlx::query_as::<_, (Uuid, i64, i64)>(sqlx::AssertSqlSafe(sql));
    if let Some(owners) = owners {
        query = query.bind(owners);
    }
    query.fetch_all(db).await.inspect_err(|e| {
        tracing::error!(
            error = %e,
            catégorie = category.as_str(),
            "Recomptage d'une catégorie de consommation échoué"
        );
    })
}

/// Measures `{owner}/thumbnails/` on the storage backend.
///
/// Thumbnail sizes exist **nowhere in the database** — `drive.files` only carries
/// a `has_thumbnail` flag — so the only honest measure is to ask the backend.
/// `StorageBackend::list` returns each object's size, and the thumbnail tree is
/// flat (`{owner}/thumbnails/{file_id}.jpg`), so one non-recursive listing per
/// account is exact.
///
/// It is a directory walk per account, which is why it happens **only during the
/// six-hourly full sync**. The result is kept in memory so the five-second
/// incremental flushes can restate it without touching the disk; a thumbnail
/// generated in between is therefore declared late, which is the right trade for
/// a figure nobody is billed on.
///
/// A missing directory is a real zero (the account has no thumbnails) and is
/// recorded as such. Any other error leaves the last known figure in place: a
/// backend hiccup must not publish "no thumbnails" for an account that has some.
async fn refresh_thumbnails(
    storage: &Arc<dyn StorageBackend>,
    owners: &[Uuid],
    cache: &mut HashMap<Uuid, (i64, i64)>,
) {
    let live: HashSet<Uuid> = owners.iter().copied().collect();
    cache.retain(|owner, _| live.contains(owner));

    for owner in owners {
        let prefix = format!("{owner}/thumbnails");
        match storage.list(&prefix).await {
            Ok(objects) => {
                let bytes: i64 = objects
                    .iter()
                    .map(|o| i64::try_from(o.size).unwrap_or(i64::MAX))
                    .sum();
                cache.insert(*owner, (bytes, objects.len() as i64));
            }
            Err(StorageError::NotFound(_)) => {
                cache.insert(*owner, (0, 0));
            }
            Err(e) => {
                tracing::warn!(
                    owner = %owner,
                    error = %e,
                    "Mesure des miniatures impossible — dernière valeur connue conservée"
                );
            }
        }
    }
}

/// Builds a whole declaration.
///
/// `owners = None` is the full sync: every account is recounted, thumbnails are
/// re-measured, and empty `(account, category)` pairs are dropped so the core
/// retires them. `Some(list)` is the incremental path: only those accounts, and
/// every category stated explicitly — including at zero, because a partial
/// declaration retires nothing.
async fn collect(
    state: &AppState,
    owners: Option<&[Uuid]>,
    thumbnails: &mut HashMap<Uuid, (i64, i64)>,
) -> Result<Vec<Entry>, sqlx::Error> {
    let paths = stored_paths(&state.db, owners).await?;
    let mut entries = fold_paths(&paths);

    for category in [
        Category::Versions,
        Category::Index,
        Category::Cache,
        Category::Staging,
    ] {
        for (user_id, used_bytes, object_count) in aggregate(&state.db, category, owners).await? {
            entries.push(Entry {
                user_id,
                category,
                used_bytes,
                object_count,
            });
        }
    }

    match owners {
        None => {
            // Accounts are discovered from what they hold. One that holds
            // nothing but thumbnails is therefore not measured — which is
            // harmless, since a thumbnail cannot exist without the file it was
            // rendered from having existed too.
            let all: Vec<Uuid> = entries
                .iter()
                .map(|e| e.user_id)
                .collect::<HashSet<_>>()
                .into_iter()
                .collect();
            refresh_thumbnails(&state.storage, &all, thumbnails).await;
            for (user_id, (used_bytes, object_count)) in thumbnails.iter() {
                entries.push(Entry {
                    user_id: *user_id,
                    category: Category::Thumbnails,
                    used_bytes: *used_bytes,
                    object_count: *object_count,
                });
            }
            // Omission is the retirement: sending an explicit zero would leave a
            // dead row in the breakdown forever.
            entries.retain(|e| e.used_bytes != 0 || e.object_count != 0);
        }
        Some(owners) => {
            let present: HashSet<(Uuid, Category)> =
                entries.iter().map(|e| (e.user_id, e.category)).collect();
            for owner in owners {
                for category in ZERO_FILLED {
                    if !present.contains(&(*owner, *category)) {
                        entries.push(Entry {
                            user_id: *owner,
                            category: *category,
                            used_bytes: 0,
                            object_count: 0,
                        });
                    }
                }
                // Restated from the last full measure; omitted when there has
                // never been one, so the core keeps whatever it already holds.
                if let Some((used_bytes, object_count)) = thumbnails.get(owner) {
                    entries.push(Entry {
                        user_id: *owner,
                        category: Category::Thumbnails,
                        used_bytes: *used_bytes,
                        object_count: *object_count,
                    });
                }
            }
        }
    }

    entries.sort_by_key(|e| (e.user_id, e.category));
    Ok(entries)
}

// ── Sending ──────────────────────────────────────────────────────────────────

/// Identifier this module declares under. Only consulted by the core when the
/// caller could not be identified from its secret — see below.
const MODULE_ID: &str = "drive";

/// Sends one declaration to the core.
///
/// ## Why `module_id` is in the body *and* why that is not a hole
///
/// The core derives a distinct `X-Internal-Secret` per module and prefers that
/// identity over anything the body says: when the two disagree the request is
/// refused with 403, so a module holding its own secret can never write under
/// another's name. The body value is only consulted when the caller is *not*
/// identified — which is the case whenever a module is handed the master secret
/// (development, and currently also the supervised path, since the core's module
/// spawner does not derive per-module secrets yet).
///
/// Sending it is therefore what makes the declaration work today, and it becomes
/// dead weight — not a bypass — the day the spawner starts deriving. This is
/// exactly the arrangement `/internal/modules/register` already uses.
async fn send(
    http: &reqwest::Client,
    state: &AppState,
    entries: &[Entry],
    full: bool,
) -> Result<(), String> {
    let url = format!("{}/internal/storage/usage", state.settings.core.url);
    let usage: Vec<_> = entries
        .iter()
        .map(|e| {
            json!({
                "user_id":      e.user_id,
                "category":     e.category.as_str(),
                "used_bytes":   e.used_bytes,
                "object_count": e.object_count,
            })
        })
        .collect();

    let resp = http
        .post(&url)
        .header(
            "X-Internal-Secret",
            state.settings.core.internal_secret.as_str(),
        )
        .json(&json!({ "module_id": MODULE_ID, "full": full, "usage": usage }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        return Ok(());
    }

    // The status alone does not say which of several validations refused the
    // declaration, and this runs unattended — a log line that reads "HTTP 422"
    // costs an afternoon the next time the contract shifts.
    let status = resp.status();
    let detail = resp.text().await.unwrap_or_default();
    let detail: String = detail.chars().take(300).collect();
    Err(format!("HTTP {status} {detail}"))
}

/// Declares `entries` in as many calls as the core's per-request ceiling
/// requires.
///
/// `full` is only claimed when the whole state fits in one call: a chunked
/// declaration marked full would retire everything outside the chunk that
/// happened to be sent last. Chunked declarations are therefore partial, which
/// is correct but cannot retire a row — a limitation that only matters beyond
/// [`MAX_ENTRIES`] entries, and one the incremental path already covers (a
/// category dropping to zero marks the owner dirty, and zero is declared
/// explicitly). Returns `true` when every call landed — the caller uses that to
/// decide whether a full sync needs retrying sooner than its normal period.
async fn declare(http: &reqwest::Client, state: &AppState, entries: Vec<Entry>, full: bool) -> bool {
    let single_call = entries.len() <= MAX_ENTRIES;
    if full && !single_call {
        tracing::warn!(
            entrées = entries.len(),
            "Synchronisation complète découpée : déclarée en plusieurs envois partiels"
        );
    }

    // An empty full declaration is meaningful and must still be sent: it is how
    // drive says "I hold nothing for anybody", which the core must be able to
    // tell apart from "drive has never declared".
    if entries.is_empty() {
        if full {
            return match send(http, state, &[], true).await {
                Ok(()) => {
                    tracing::debug!("Consommation déclarée : aucun compte");
                    true
                }
                Err(e) => {
                    tracing::warn!(error = %e, "Déclaration de consommation échouée");
                    false
                }
            };
        }
        return true;
    }

    let mut declared_bytes: i64 = 0;
    let mut billed_bytes: i64 = 0;
    let mut declared_entries = 0usize;
    let mut all_ok = true;
    for chunk in entries.chunks(MAX_ENTRIES) {
        match send(http, state, chunk, full && single_call).await {
            Ok(()) => {
                declared_bytes += chunk.iter().map(|e| e.used_bytes).sum::<i64>();
                billed_bytes += billable_bytes(chunk);
                declared_entries += chunk.len();
            }
            Err(e) => {
                // Incremental declarations are never retried here: the next
                // flush declares the current state again, and retrying a stale
                // total would be work done to publish an out-of-date number. A
                // *full* declaration is different — it is the repair path, and
                // its caller reschedules it on this return value.
                all_ok = false;
                tracing::warn!(error = %e, entrées = chunk.len(), "Déclaration de consommation échouée");
            }
        }
    }

    if declared_entries > 0 {
        let accounts = entries
            .iter()
            .map(|e| e.user_id)
            .collect::<HashSet<_>>()
            .len();
        tracing::debug!(
            comptes = accounts,
            entrées = declared_entries,
            octets = declared_bytes,
            octets_facturés = billed_bytes,
            complète = full && single_call,
            "Consommation déclarée au core"
        );
    }
    all_ok
}

/// The reporter task. Started once at bootstrap.
pub async fn run_reporter(state: AppState) {
    let (tx, mut rx) = mpsc::unbounded_channel::<Uuid>();
    if DIRTY.set(tx).is_err() {
        tracing::error!("Rapporteur de consommation déjà démarré — second démarrage ignoré");
        return;
    }

    let http = reqwest::Client::new();
    let mut pending: HashSet<Uuid> = HashSet::new();

    // Last known thumbnail measure per account, refreshed by the full sync only.
    // It lives in the task rather than in a `static` because nothing outside this
    // loop reads it, and a task-local value cannot be corrupted by a second
    // reporter that should not exist in the first place.
    let mut thumbnails: HashMap<Uuid, (i64, i64)> = HashMap::new();

    // Absolute deadlines rather than `interval`s, so a failed full sync can be
    // pulled forward without disturbing the incremental rhythm.
    let mut flush_at = tokio::time::Instant::now() + FLUSH_INTERVAL;
    let mut full_at = tokio::time::Instant::now(); // the first one is immediate
    let mut full_backoff = FULL_RETRY_MIN;

    tracing::info!("Rapporteur de consommation démarré (déclaration au core)");

    loop {
        tokio::select! {
            // The channel's sender lives in a `static` for the process's whole
            // life, so `recv` never yields `None` and this branch never retires.
            Some(owner) = rx.recv() => {
                pending.insert(owner);
            }

            _ = tokio::time::sleep_until(flush_at) => {
                flush_at = tokio::time::Instant::now() + FLUSH_INTERVAL;
                if pending.is_empty() {
                    continue;
                }
                let owners: Vec<Uuid> = pending.drain().collect();
                match collect(&state, Some(&owners), &mut thumbnails).await {
                    Ok(entries) => { declare(&http, &state, entries, false).await; }
                    // Already logged where it happened, with the failing query's
                    // category; this line only adds how many accounts lost their
                    // update.
                    Err(_) => tracing::error!(
                        comptes = owners.len(),
                        "Recomptage de la consommation échoué"
                    ),
                }
            }

            // Fires immediately at startup — the first thing the module does
            // once it is up is state its complete position. Retried with a
            // growing backoff until it lands, because the core is often not
            // ready to accept it on the first attempt.
            _ = tokio::time::sleep_until(full_at) => {
                let delivered = match collect(&state, None, &mut thumbnails).await {
                    Ok(entries) => {
                        // A full declaration supersedes everything queued.
                        pending.clear();
                        declare(&http, &state, entries, true).await
                    }
                    Err(_) => {
                        tracing::error!("Recomptage complet de la consommation échoué");
                        false
                    }
                };

                let now = tokio::time::Instant::now();
                if delivered {
                    full_at = now + FULL_SYNC_INTERVAL;
                    full_backoff = FULL_RETRY_MIN;
                } else {
                    full_at = now + full_backoff;
                    full_backoff = (full_backoff * 2).min(FULL_SYNC_INTERVAL);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owner() -> Uuid {
        Uuid::from_u128(1)
    }

    fn path(storage_path: &str, size_bytes: i64, all_trashed: bool, in_system: bool) -> StoredPath {
        StoredPath {
            owner_id: owner(),
            storage_path: storage_path.to_string(),
            size_bytes,
            all_trashed,
            in_system,
        }
    }

    fn entry_for(entries: &[Entry], category: Category) -> Option<&Entry> {
        entries.iter().find(|e| e.category == category)
    }

    /// The defect this module was rewritten for: `drive.files` holds several
    /// rows per physical object, and the disk holds the object once.
    #[test]
    fn a_storage_path_shared_by_two_rows_is_counted_once() {
        let entries = fold_paths(&[
            path("u/files/report.pdf", 1_000, false, false),
            path("u/files/report.pdf", 1_000, false, false),
        ]);

        let content = entry_for(&entries, Category::Content).expect("content déclaré");
        assert_eq!(content.used_bytes, 1_000, "les octets ne sont comptés qu'une fois");
        assert_eq!(content.object_count, 1, "un seul objet physique");
    }

    /// A path shared between a trashed row and a live one is live. Counting it in
    /// both would inflate the account by the size of the object.
    #[test]
    fn a_path_still_referenced_by_a_live_row_stays_in_content() {
        let entries = fold_paths(&[
            path("u/files/shared.docx", 500, true, false),
            path("u/files/shared.docx", 500, false, false),
        ]);

        assert_eq!(
            entry_for(&entries, Category::Content).map(|e| e.used_bytes),
            Some(500)
        );
        assert!(
            entry_for(&entries, Category::Trash).is_none(),
            "un objet n'est jamais dans deux catégories"
        );
    }

    #[test]
    fn a_trashed_file_falls_in_trash_and_not_in_content() {
        let entries = fold_paths(&[
            path("u/files/kept.txt", 100, false, false),
            path("u/files/deleted.txt", 400, true, false),
        ]);

        assert_eq!(
            entry_for(&entries, Category::Content).map(|e| e.used_bytes),
            Some(100)
        );
        assert_eq!(
            entry_for(&entries, Category::Trash).map(|e| e.used_bytes),
            Some(400)
        );
    }

    /// Fonts and dictionaries sit in the account's tree but the platform put them
    /// there — billing them would charge people for the module working.
    #[test]
    fn a_system_file_is_declared_as_system_and_is_not_billed() {
        let entries = fold_paths(&[
            path("u/files/photo.jpg", 700, false, false),
            path("u/files/System/Fonts/Roboto.ttf", 300, false, true),
        ]);

        let system = entry_for(&entries, Category::System).expect("system déclaré");
        assert_eq!(system.used_bytes, 300);
        assert!(!system.category.is_billable());
        assert_eq!(billable_bytes(&entries), 700);
    }

    /// A trashed system file is still the platform's, not the account's.
    #[test]
    fn system_wins_over_trash() {
        let entries = fold_paths(&[path("u/files/System/Fonts/old.ttf", 42, true, true)]);
        assert_eq!(
            entry_for(&entries, Category::System).map(|e| e.used_bytes),
            Some(42)
        );
        assert!(entry_for(&entries, Category::Trash).is_none());
    }

    /// What the account is charged for is exactly what it can free by itself:
    /// `content` + `trash` + `versions`. However much of the disk the module's
    /// own machinery occupies, none of it lands on the invoice.
    #[test]
    fn billed_categories_are_the_ones_the_account_can_free() {
        let user_id = owner();
        let entries: Vec<Entry> = [
            (Category::Content, 1_000),
            (Category::Trash, 200),
            (Category::Versions, 5_000),
            (Category::Thumbnails, 800),
            (Category::Index, 300),
            (Category::Cache, 60),
            (Category::Staging, 900),
            (Category::System, 10_000),
        ]
        .into_iter()
        .map(|(category, used_bytes)| Entry {
            user_id,
            category,
            used_bytes,
            object_count: 1,
        })
        .collect();

        assert_eq!(billable_bytes(&entries), 6_200);
        for entry in &entries {
            assert_eq!(
                entry.category.is_billable(),
                matches!(
                    entry.category,
                    Category::Content | Category::Trash | Category::Versions
                )
            );
        }
    }

    /// One account produces up to eight entries, so the page size is a count of
    /// entries — a page built on accounts would overshoot the core's ceiling by
    /// eight and be refused whole.
    #[test]
    fn pages_are_cut_on_entries_not_on_accounts() {
        let entries: Vec<Entry> = (0..MAX_ENTRIES + 1)
            .map(|i| Entry {
                user_id: Uuid::from_u128(i as u128),
                category: Category::Content,
                used_bytes: 1,
                object_count: 1,
            })
            .collect();

        let pages: Vec<&[Entry]> = entries.chunks(MAX_ENTRIES).collect();
        assert_eq!(pages.len(), 2);
        assert_eq!(pages[0].len(), MAX_ENTRIES);
        assert_eq!(pages[1].len(), 1);
    }

    /// The wire vocabulary is closed on the core's side: a typo here is a 422 and
    /// a slice of the breakdown that silently never arrives.
    #[test]
    fn wire_identifiers_match_the_cores_vocabulary() {
        assert_eq!(Category::Content.as_str(), "content");
        assert_eq!(Category::Trash.as_str(), "trash");
        assert_eq!(Category::Versions.as_str(), "versions");
        assert_eq!(Category::Thumbnails.as_str(), "thumbnails");
        assert_eq!(Category::Index.as_str(), "index");
        assert_eq!(Category::Cache.as_str(), "cache");
        assert_eq!(Category::Staging.as_str(), "staging");
        assert_eq!(Category::System.as_str(), "system");
    }
}
