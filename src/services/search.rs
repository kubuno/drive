//! Service de recherche. Palier plein-texte toujours actif (Postgres FTS + trigram).
//! Palier sémantique optionnel (embeddings + cosinus) fusionné si un fournisseur est joignable.

use crate::models::file::File;
use crate::services::{embeddings, phash};
use crate::state::AppState;
use sqlx::{Postgres, QueryBuilder, Row};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Default)]
pub struct SearchParams {
    pub q:              String,
    pub type_filter:    String, // all|folder|document|spreadsheet|presentation|pdf|image|video|audio|archive
    pub owner:          String, // anyone|me|notme
    pub date:           String, // anytime|today|7days|30days|thisyear|lastyear
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
    pub match_kind:  String, // "text" | "name" | "semantic"
    pub folder_path: Option<String>, // chemin matérialisé du dossier parent
}

const CAND_CAP: i64 = 400; // plafond de candidats classés (échelle perso) → pagination en mémoire

/// Fragment SQL filtrant par catégorie de type MIME. Renvoie false si le type exclut tout fichier.
fn push_type_filter(qb: &mut QueryBuilder<Postgres>, t: &str) -> bool {
    match t {
        "" | "all" => true,
        "folder" => false, // les dossiers ne sont pas indexés ici
        "pdf" => { qb.push(" AND si.mime_type = 'application/pdf'"); true }
        "image" => { qb.push(" AND si.mime_type LIKE 'image/%'"); true }
        "video" => { qb.push(" AND si.mime_type LIKE 'video/%'"); true }
        "audio" => { qb.push(" AND si.mime_type LIKE 'audio/%'"); true }
        "document" => { qb.push(" AND (si.mime_type LIKE 'text/%' OR si.mime_type LIKE '%word%' OR si.mime_type LIKE '%opendocument.text%' OR si.mime_type LIKE '%rtf%')"); true }
        "spreadsheet" => { qb.push(" AND (si.mime_type LIKE '%excel%' OR si.mime_type LIKE '%spreadsheet%' OR si.mime_type LIKE '%csv%')"); true }
        "presentation" => { qb.push(" AND (si.mime_type LIKE '%powerpoint%' OR si.mime_type LIKE '%presentation%')"); true }
        "archive" => { qb.push(" AND (si.mime_type LIKE '%zip%' OR si.mime_type LIKE '%tar%' OR si.mime_type LIKE '%rar%' OR si.mime_type LIKE '%7z%' OR si.mime_type LIKE '%gzip%')"); true }
        _ => true,
    }
}

fn date_interval(date: &str) -> Option<&'static str> {
    match date {
        "today"    => Some("1 day"),
        "7days"    => Some("7 days"),
        "30days"   => Some("30 days"),
        "thisyear" => Some("1 year"),
        "lastyear" => Some("2 years"),
        _ => None,
    }
}

pub async fn search(
    state: &AppState,
    http: &reqwest::Client,
    owner_id: Uuid,
    p: &SearchParams,
) -> Result<(Vec<SearchHit>, usize, bool), sqlx::Error> {
    // Rien à chercher, ou type qui exclut tout fichier → vide.
    let has_query = !p.q.trim().is_empty() || !p.item_name.trim().is_empty() || !p.contains_words.trim().is_empty();
    if !has_query || p.type_filter == "folder" || p.owner == "notme" {
        return Ok((Vec::new(), 0, false));
    }

    let q = p.q.trim();
    let limit  = p.limit.clamp(1, 100) as usize;
    let offset = p.offset.max(0) as usize;

    // ── Palier 1 : plein-texte (FTS) + nom (trigram, tolérant aux fautes) ───────
    // name_sim = similarité trigramme du nom (0..1) → tolérance aux fautes de frappe.
    let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
        "SELECT si.file_id, \
                ts_rank(si.tsv, websearch_to_tsquery('simple', unaccent(",
    );
    qb.push_bind(q);
    qb.push("))) AS rank, \
             (si.tsv @@ websearch_to_tsquery('simple', unaccent(");
    qb.push_bind(q);
    qb.push("))) AS text_match, \
             similarity(unaccent(si.name), unaccent(");
    qb.push_bind(q);
    qb.push(")) AS name_sim, \
             ts_headline('simple', unaccent(coalesce(si.content_text, si.name)), websearch_to_tsquery('simple', unaccent(");
    qb.push_bind(q);
    qb.push(")), 'StartSel=<b>,StopSel=</b>,MaxFragments=2,MaxWords=18,MinWords=5') AS snippet \
             FROM drive.search_index si JOIN drive.files f ON f.id = si.file_id \
             WHERE si.owner_id = ");
    qb.push_bind(owner_id);
    qb.push(" AND f.is_trashed = ");
    qb.push_bind(p.trash);

    // Correspondance : FTS OU sous-chaîne du nom OU nom trigramme-similaire (fautes).
    qb.push(" AND (si.tsv @@ websearch_to_tsquery('simple', unaccent(");
    qb.push_bind(q);
    qb.push(")) OR si.name ILIKE ");
    qb.push_bind(format!("%{q}%"));
    qb.push(" OR unaccent(si.name) % unaccent(");
    qb.push_bind(q);
    qb.push("))");

    if !push_type_filter(&mut qb, &p.type_filter) {
        return Ok((Vec::new(), 0, false));
    }
    if p.starred {
        qb.push(" AND f.is_starred = TRUE");
    }
    if !p.item_name.trim().is_empty() {
        qb.push(" AND si.name ILIKE ");
        qb.push_bind(format!("%{}%", p.item_name.trim()));
    }
    if let Some(iv) = date_interval(&p.date) {
        qb.push(" AND f.updated_at >= NOW() - INTERVAL '");
        qb.push(iv); // littéral contrôlé (whitelist)
        qb.push("'");
    }
    qb.push(" ORDER BY GREATEST(ts_rank(si.tsv, websearch_to_tsquery('simple', unaccent(");
    qb.push_bind(q);
    qb.push("))), similarity(unaccent(si.name), unaccent(");
    qb.push_bind(q);
    qb.push("))) DESC NULLS LAST LIMIT ");
    qb.push_bind(CAND_CAP);

    let rows = qb.build().fetch_all(&state.db).await?;

    let mut order: Vec<Uuid> = Vec::new();
    let mut rank_by: HashMap<Uuid, f32> = HashMap::new();
    let mut namesim_by: HashMap<Uuid, f32> = HashMap::new();
    let mut snippet_by: HashMap<Uuid, Option<String>> = HashMap::new();
    let mut kind_by: HashMap<Uuid, String> = HashMap::new();
    let mut max_rank = 0f32;
    for r in &rows {
        let id: Uuid = r.get("file_id");
        let rank: f32 = r.try_get("rank").unwrap_or(0.0);
        let name_sim: f32 = r.try_get("name_sim").unwrap_or(0.0);
        let text_match: bool = r.try_get("text_match").unwrap_or(false);
        let snippet: Option<String> = r.try_get("snippet").ok();
        max_rank = max_rank.max(rank);
        order.push(id);
        rank_by.insert(id, rank);
        namesim_by.insert(id, name_sim);
        snippet_by.insert(id, snippet);
        kind_by.insert(id, if text_match { "text".into() } else { "name".into() });
    }

    // Score plein-texte normalisé (0..1), combiné avec la similarité de nom (fautes
    // de frappe) : on garde le meilleur des deux.
    let mut score_by: HashMap<Uuid, f32> = HashMap::new();
    for id in &order {
        let r = rank_by.get(id).copied().unwrap_or(0.0);
        let ts = if max_rank > 0.0 { r / max_rank } else { 0.0 };
        let ns = namesim_by.get(id).copied().unwrap_or(0.0);
        score_by.insert(*id, ts.max(ns).max(0.01));
    }

    // ── Palier 2 : sémantique (optionnel, fail-open) ────────────────────────────
    let mut semantic_active = false;
    if embeddings::is_enabled(&state.settings.embeddings) {
        if let Ok(qvec) = embeddings::embed(http, &state.settings.embeddings, q).await {
            semantic_active = true;
            // Vecteurs candidats de l'utilisateur (brute-force — échelle perso)
            let cand = sqlx::query(
                "SELECT si.file_id, si.embedding FROM drive.search_index si \
                 JOIN drive.files f ON f.id = si.file_id \
                 WHERE si.owner_id = $1 AND f.is_trashed = $2 AND si.embedding IS NOT NULL",
            )
            .bind(owner_id)
            .bind(p.trash)
            .fetch_all(&state.db)
            .await?;

            let mut sem: Vec<(Uuid, f32)> = Vec::new();
            for r in &cand {
                let id: Uuid = r.get("file_id");
                let emb: Vec<f32> = r.try_get("embedding").unwrap_or_default();
                let cos = embeddings::cosine_similarity(&qvec, &emb);
                if cos > 0.20 {
                    sem.push((id, cos));
                }
            }
            sem.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            sem.truncate(CAND_CAP as usize);

            for (id, cos) in sem {
                let blended = if let Some(fts) = score_by.get(&id) {
                    0.6 * fts + 0.4 * cos // présent dans les deux
                } else {
                    order.push(id); // hit purement sémantique
                    kind_by.insert(id, "semantic".into());
                    snippet_by.insert(id, None);
                    0.4 * cos
                };
                score_by.insert(id, blended);
            }
        }
    }

    if order.is_empty() {
        return Ok((Vec::new(), 0, semantic_active));
    }

    // ── Récupération des lignes File + assemblage trié par score (pertinence) ───
    let files = sqlx::query_as::<_, File>("SELECT * FROM drive.files WHERE id = ANY($1)")
        .bind(&order)
        .fetch_all(&state.db)
        .await?;
    let file_by: HashMap<Uuid, File> = files.into_iter().map(|f| (f.id, f)).collect();

    let mut hits: Vec<SearchHit> = order
        .iter()
        .filter_map(|id| {
            file_by.get(id).map(|f| SearchHit {
                file: f.clone(),
                snippet: snippet_by.get(id).cloned().flatten(),
                score: score_by.get(id).copied().unwrap_or(0.0),
                match_kind: kind_by.get(id).cloned().unwrap_or_else(|| "text".into()),
                folder_path: None,
            })
        })
        .collect();

    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    // Pagination en mémoire (le classement par pertinence est complet sur le pool capé).
    let total = hits.len();
    let mut page: Vec<SearchHit> = hits.into_iter().skip(offset).take(limit).collect();

    // Chemin matérialisé du dossier parent pour chaque résultat de la page.
    let folder_ids: Vec<Uuid> = page.iter().filter_map(|h| h.file.folder_id).collect();
    if !folder_ids.is_empty() {
        let rows = sqlx::query("SELECT id, path FROM drive.folders WHERE id = ANY($1)")
            .bind(&folder_ids)
            .fetch_all(&state.db)
            .await?;
        let path_by: HashMap<Uuid, String> = rows.iter().map(|r| (r.get::<Uuid, _>("id"), r.get::<String, _>("path"))).collect();
        for h in &mut page {
            if let Some(fid) = h.file.folder_id {
                h.folder_path = path_by.get(&fid).cloned();
            }
        }
    }

    Ok((page, total, semantic_active))
}

/// Recherche d'images SIMILAIRES par empreinte perceptuelle (dHash → distance de Hamming).
/// `query_phash` = empreinte de l'image requête. Renvoie les images les plus proches.
pub async fn search_similar(
    state: &AppState,
    owner_id: Uuid,
    query_phash: i64,
    limit: usize,
) -> Result<(Vec<SearchHit>, usize), sqlx::Error> {
    let rows = sqlx::query(
        "SELECT file_id, phash FROM drive.search_index \
         WHERE owner_id = $1 AND is_trashed = FALSE AND phash IS NOT NULL",
    )
    .bind(owner_id)
    .fetch_all(&state.db)
    .await?;

    // Distance de Hamming ; on garde les plus proches (≤ 22 bits ≈ visuellement proches).
    let mut scored: Vec<(Uuid, u32)> = rows
        .iter()
        .map(|r| (r.get::<Uuid, _>("file_id"), phash::hamming(query_phash, r.get::<i64, _>("phash"))))
        .filter(|(_, d)| *d <= 22)
        .collect();
    scored.sort_by_key(|x| x.1);
    let total = scored.len();
    scored.truncate(limit);
    if scored.is_empty() {
        return Ok((Vec::new(), 0));
    }

    let ids: Vec<Uuid> = scored.iter().map(|x| x.0).collect();
    let files = sqlx::query_as::<_, File>("SELECT * FROM drive.files WHERE id = ANY($1)")
        .bind(&ids)
        .fetch_all(&state.db)
        .await?;
    let file_by: HashMap<Uuid, File> = files.into_iter().map(|f| (f.id, f)).collect();

    let folder_ids: Vec<Uuid> = file_by.values().filter_map(|f| f.folder_id).collect();
    let path_by: HashMap<Uuid, String> = if folder_ids.is_empty() {
        HashMap::new()
    } else {
        sqlx::query("SELECT id, path FROM drive.folders WHERE id = ANY($1)")
            .bind(&folder_ids)
            .fetch_all(&state.db)
            .await?
            .iter()
            .map(|r| (r.get::<Uuid, _>("id"), r.get::<String, _>("path")))
            .collect()
    };

    let hits: Vec<SearchHit> = scored
        .iter()
        .filter_map(|(id, dist)| {
            file_by.get(id).map(|f| SearchHit {
                file: f.clone(),
                snippet: None,
                score: (64 - *dist) as f32 / 64.0, // proximité 0..1
                match_kind: "image".into(),
                folder_path: f.folder_id.and_then(|fid| path_by.get(&fid).cloned()),
            })
        })
        .collect();

    Ok((hits, total))
}
