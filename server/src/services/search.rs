//! Service de recherche, portable sur les trois moteurs.
//!
//! Le plein-texte ne repose plus sur tsvector/ts_rank/websearch/pg_trgm (PostgreSQL
//! seulement) mais sur `kubuno_db::search` : le nom et le contenu extrait sont
//! réduits en radicaux (Snowball FR) à l'indexation dans `name_norm`/`content_norm`,
//! et une requête est passée dans le même `normalize()` puis appariée par `LIKE`
//! portable, le nom (poids A) primant sur le contenu (poids B).
//! Palier sémantique optionnel (embeddings + cosinus) fusionné si un fournisseur répond.

use crate::models::file::File;
use crate::services::{embeddings, phash};
use crate::state::AppState;
use kubuno_db::dialect::{Backend, Unit};
use kubuno_db::search::{Field, Query, Weight};
use kubuno_db::{params, DbPool, DbQueryBuilder, DbValue};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Default)]
pub struct SearchParams {
    pub q:              String,
    pub type_filter:    String,
    pub owner:          String,
    pub date:           String,
    pub trash:          bool,
    pub starred:        bool,
    pub item_name:      String,
    pub contains_words: String,
    pub limit:          i64,
    pub offset:         i64,
}

pub struct SearchHit {
    pub file:        File,
    pub snippet:     Option<String>,
    pub score:       f32,
    pub match_kind:  String, // "text" | "semantic" | "image"
    pub folder_path: Option<String>,
}

const CAND_CAP: i64 = 400; // plafond de candidats classés → pagination en mémoire

/// Fragment SQL filtrant par catégorie de type MIME. `None` = ce type exclut tout fichier.
fn type_filter_sql(t: &str) -> Option<String> {
    Some(match t {
        "" | "all" => String::new(),
        "pdf" => " AND si.mime_type = 'application/pdf'".into(),
        "image" => " AND si.mime_type LIKE 'image/%'".into(),
        "video" => " AND si.mime_type LIKE 'video/%'".into(),
        "audio" => " AND si.mime_type LIKE 'audio/%'".into(),
        "document" => " AND (si.mime_type LIKE 'text/%' OR si.mime_type LIKE '%word%' OR si.mime_type LIKE '%opendocument.text%' OR si.mime_type LIKE '%rtf%')".into(),
        "spreadsheet" => " AND (si.mime_type LIKE '%excel%' OR si.mime_type LIKE '%spreadsheet%' OR si.mime_type LIKE '%csv%')".into(),
        "presentation" => " AND (si.mime_type LIKE '%powerpoint%' OR si.mime_type LIKE '%presentation%')".into(),
        "archive" => " AND (si.mime_type LIKE '%zip%' OR si.mime_type LIKE '%tar%' OR si.mime_type LIKE '%rar%' OR si.mime_type LIKE '%7z%' OR si.mime_type LIKE '%gzip%')".into(),
        _ => String::new(),
    })
}

/// `AND f.updated_at >= NOW() - INTERVAL …`, per engine (no year unit; approximated in days).
fn date_filter(date: &str, b: Backend) -> Option<String> {
    let (n, unit) = match date {
        "today" => (1u32, Unit::Day),
        "7days" => (7, Unit::Day),
        "30days" => (30, Unit::Day),
        "thisyear" => (365, Unit::Day),
        "lastyear" => (730, Unit::Day),
        _ => return None,
    };
    Some(format!(" AND f.updated_at >= {}", b.interval_before(n, unit)))
}

#[derive(sqlx::FromRow)]
struct IdRow {
    file_id: Uuid,
}
#[derive(sqlx::FromRow)]
struct EmbRow {
    file_id: Uuid,
    #[sqlx(json)]
    embedding: Vec<f32>,
}
#[derive(sqlx::FromRow)]
struct FolderPathRow {
    id: Uuid,
    path: String,
}

pub async fn search(
    state: &AppState,
    http: &reqwest::Client,
    owner_id: Uuid,
    p: &SearchParams,
) -> Result<(Vec<SearchHit>, usize, bool), sqlx::Error> {
    let has_query =
        !p.q.trim().is_empty() || !p.item_name.trim().is_empty() || !p.contains_words.trim().is_empty();
    if !has_query || p.type_filter == "folder" || p.owner == "notme" {
        return Ok((Vec::new(), 0, false));
    }

    let db = &state.db;
    let b = db.backend();
    let q = p.q.trim();
    let limit = p.limit.clamp(1, 100) as usize;
    let offset = p.offset.max(0) as usize;

    // ── Base filters (owner, trash, item name, type, starred, date) ────────────
    let type_frag = match type_filter_sql(&p.type_filter) {
        Some(f) => f,
        None => return Ok((Vec::new(), 0, false)),
    };

    // Binds accumulate in strict textual placeholder order.
    let mut ps: Vec<DbValue> = vec![DbValue::from(owner_id), DbValue::from(p.trash)];
    let mut next = 3usize;
    let mut where_sql = String::from("si.owner_id = $1 AND f.is_trashed = $2");

    if !p.item_name.trim().is_empty() {
        where_sql.push_str(&format!(" AND {}", b.ilike("si.name", next)));
        ps.push(DbValue::from(format!("%{}%", p.item_name.trim())));
        next += 1;
    }
    where_sql.push_str(&type_frag);
    if p.starred {
        where_sql.push_str(" AND f.is_starred = TRUE");
    }
    if let Some(d) = date_filter(&p.date, b) {
        where_sql.push_str(&d);
    }

    // ── Full-text match + ranking (kubuno_db::search) ──────────────────────────
    // The WHERE fts block is numbered from `next`; the ORDER BY block follows it,
    // and sits after the WHERE in the text, so placeholders stay increasing.
    let fields = [Field::new("name_norm", Weight::A), Field::new("content_norm", Weight::B)];
    let order_clause;
    let limit_ph;
    if let Some(fts) = Query::build(q, &fields, next) {
        where_sql.push_str(&format!(" AND {}", fts.where_sql));
        order_clause = format!("{} DESC", fts.order_sql);
        limit_ph = fts.next;
        ps.extend(fts.binds);
    } else {
        // No stems (query empty / all stop chars): fall back to a plain listing
        // filtered by the base conditions, newest first.
        order_clause = "f.updated_at DESC".to_string();
        limit_ph = next;
    }
    ps.push(DbValue::from(CAND_CAP));

    let sql = format!(
        "SELECT si.file_id FROM drive.search_index si
         JOIN drive.files f ON f.id = si.file_id
         WHERE {where_sql}
         ORDER BY {order_clause}
         LIMIT ${limit_ph}"
    );
    let cand = db.fetch_all_as::<IdRow>(&sql, ps).await?;

    // Rank-based full-text score in [0,1] (top candidate ≈ 1.0). Enough to blend
    // with the cosine tier; the SQL already returned them in rank order.
    let mut order: Vec<Uuid> = cand.iter().map(|r| r.file_id).collect();
    let n_cand = order.len().max(1) as f32;
    let mut score_by: HashMap<Uuid, f32> = HashMap::new();
    let mut kind_by: HashMap<Uuid, String> = HashMap::new();
    for (i, id) in order.iter().enumerate() {
        score_by.insert(*id, ((order.len() - i) as f32 / n_cand).max(0.01));
        kind_by.insert(*id, "text".into());
    }

    // ── Semantic tier (optional, fail-open) ────────────────────────────────────
    let mut semantic_active = false;
    if !q.is_empty() && embeddings::is_enabled(&state.settings.embeddings) {
        if let Ok(qvec) = embeddings::embed(http, &state.settings.embeddings, q).await {
            semantic_active = true;
            let rows = db
                .fetch_all_as::<EmbRow>(
                    "SELECT si.file_id, si.embedding FROM drive.search_index si
                     JOIN drive.files f ON f.id = si.file_id
                     WHERE si.owner_id = $1 AND f.is_trashed = $2 AND si.embedding IS NOT NULL",
                    params![owner_id, p.trash],
                )
                .await?;
            let mut sem: Vec<(Uuid, f32)> = rows
                .into_iter()
                .filter_map(|r| {
                    let cos = embeddings::cosine_similarity(&qvec, &r.embedding);
                    (cos > 0.20).then_some((r.file_id, cos))
                })
                .collect();
            sem.sort_by(|a, c| c.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            sem.truncate(CAND_CAP as usize);
            for (id, cos) in sem {
                let blended = if let Some(fts) = score_by.get(&id) {
                    0.6 * fts + 0.4 * cos
                } else {
                    order.push(id);
                    kind_by.insert(id, "semantic".into());
                    0.4 * cos
                };
                score_by.insert(id, blended);
            }
        }
    }

    if order.is_empty() {
        return Ok((Vec::new(), 0, semantic_active));
    }

    // ── File rows + assembly, sorted by score ──────────────────────────────────
    let file_by = fetch_files_by_ids(db, &order).await?;

    let mut hits: Vec<SearchHit> = order
        .iter()
        .filter_map(|id| {
            file_by.get(id).map(|f| SearchHit {
                file: f.clone(),
                snippet: None,
                score: score_by.get(id).copied().unwrap_or(0.0),
                match_kind: kind_by.get(id).cloned().unwrap_or_else(|| "text".into()),
                folder_path: None,
            })
        })
        .collect();

    hits.sort_by(|a, c| c.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    let total = hits.len();
    let mut page: Vec<SearchHit> = hits.into_iter().skip(offset).take(limit).collect();

    attach_folder_paths(db, &mut page).await?;

    Ok((page, total, semantic_active))
}

/// Recherche d'images SIMILAIRES par empreinte perceptuelle (dHash → Hamming).
pub async fn search_similar(
    state: &AppState,
    owner_id: Uuid,
    query_phash: i64,
    limit: usize,
) -> Result<(Vec<SearchHit>, usize), sqlx::Error> {
    let db = &state.db;

    #[derive(sqlx::FromRow)]
    struct PhashRow {
        file_id: Uuid,
        phash: i64,
    }
    let rows = db
        .fetch_all_as::<PhashRow>(
            "SELECT file_id, phash FROM drive.search_index
             WHERE owner_id = $1 AND is_trashed = FALSE AND phash IS NOT NULL",
            params![owner_id],
        )
        .await?;

    let mut scored: Vec<(Uuid, u32)> = rows
        .iter()
        .map(|r| (r.file_id, phash::hamming(query_phash, r.phash)))
        .filter(|(_, d)| *d <= 22)
        .collect();
    scored.sort_by_key(|x| x.1);
    let total = scored.len();
    scored.truncate(limit);
    if scored.is_empty() {
        return Ok((Vec::new(), 0));
    }

    let ids: Vec<Uuid> = scored.iter().map(|x| x.0).collect();
    let file_by = fetch_files_by_ids(db, &ids).await?;

    let folder_ids: Vec<Uuid> = file_by.values().filter_map(|f| f.folder_id).collect();
    let path_by = fetch_folder_paths(db, &folder_ids).await?;

    let hits: Vec<SearchHit> = scored
        .iter()
        .filter_map(|(id, dist)| {
            file_by.get(id).map(|f| SearchHit {
                file: f.clone(),
                snippet: None,
                score: (64 - *dist) as f32 / 64.0,
                match_kind: "image".into(),
                folder_path: f.folder_id.and_then(|fid| path_by.get(&fid).cloned()),
            })
        })
        .collect();

    Ok((hits, total))
}

async fn fetch_files_by_ids(db: &DbPool, ids: &[Uuid]) -> Result<HashMap<Uuid, File>, sqlx::Error> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let mut qb = DbQueryBuilder::new(db.backend(), "SELECT * FROM drive.files WHERE id");
    qb.push_in(ids.iter().copied());
    let files: Vec<File> = qb.fetch_all_as(db).await?;
    Ok(files.into_iter().map(|f| (f.id, f)).collect())
}

async fn fetch_folder_paths(db: &DbPool, ids: &[Uuid]) -> Result<HashMap<Uuid, String>, sqlx::Error> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let mut qb = DbQueryBuilder::new(db.backend(), "SELECT id, path FROM drive.folders WHERE id");
    qb.push_in(ids.iter().copied());
    let rows: Vec<FolderPathRow> = qb.fetch_all_as(db).await?;
    Ok(rows.into_iter().map(|r| (r.id, r.path)).collect())
}

async fn attach_folder_paths(db: &DbPool, page: &mut [SearchHit]) -> Result<(), sqlx::Error> {
    let folder_ids: Vec<Uuid> = page.iter().filter_map(|h| h.file.folder_id).collect();
    if folder_ids.is_empty() {
        return Ok(());
    }
    let path_by = fetch_folder_paths(db, &folder_ids).await?;
    for h in page.iter_mut() {
        if let Some(fid) = h.file.folder_id {
            h.folder_path = path_by.get(&fid).cloned();
        }
    }
    Ok(())
}
