//! Pipeline d'indexation de recherche : détecte les fichiers « sales » (jamais indexés
//! ou dont le contenu a changé), extrait le texte, calcule l'embedding si activé, et
//! met à jour `drive.search_index`. La même détection sert au backfill initial.
//!
//! Full-text search is portable: instead of a PostgreSQL tsvector maintained by a
//! trigger, the name and extracted content are reduced to Snowball French stems
//! (`kubuno_db::normalize`) at write time into `name_norm` / `content_norm`, so
//! the same tokens are searched on every engine.

use crate::models::file::File;
use crate::services::{embeddings, extract, null_safe_distinct_cols, null_safe_eq_cols};
use crate::state::AppState;
use kubuno_db::dialect::Assign;
use kubuno_db::{params, DbPool};
use std::time::Duration;
use uuid::Uuid;

const TICK: Duration = Duration::from_secs(15);
const BATCH: i64 = 20;

/// A metadata-only reconciliation row (content already current).
#[derive(sqlx::FromRow)]
struct DriftRow {
    file_id: Uuid,
    name: String,
    folder_id: Option<Uuid>,
    mime_type: String,
    is_trashed: bool,
}

/// Boucle de fond. Indexe les fichiers sales par petits lots.
pub async fn run_worker(state: AppState) {
    let http = reqwest::Client::new();

    if embeddings::is_enabled(&state.settings.embeddings) {
        tracing::info!(
            model = state.settings.embeddings.model.as_deref().unwrap_or("?"),
            "Recherche : sémantique ACTIVÉ (embeddings)"
        );
    } else {
        tracing::info!("Recherche : plein-texte seulement (sémantique désactivé)");
    }

    loop {
        match index_batch(&state, &http, BATCH).await {
            Ok(0) => {}
            Ok(n) => tracing::debug!(count = n, "search: lot indexé"),
            Err(e) => tracing::warn!(error = %e, "search: échec d'indexation du lot"),
        }
        match reconcile_metadata(&state.db).await {
            Ok(0) => {}
            Ok(n) => tracing::debug!(count = n, "search: métadonnées réconciliées"),
            Err(e) => tracing::warn!(error = %e, "search: échec de réconciliation des métadonnées"),
        }
        tokio::time::sleep(TICK).await;
    }
}

/// Indexe jusqu'à `limit` fichiers sales. Renvoie le nombre traité.
pub async fn index_batch(state: &AppState, http: &reqwest::Client, limit: i64) -> anyhow::Result<usize> {
    // "Dirty" = never indexed, or its content hash drifted from what was indexed.
    let distinct = null_safe_distinct_cols(state.db.backend(), "si.indexed_hash", "f.content_hash");
    let sql = format!(
        r#"SELECT f.* FROM drive.files f
           LEFT JOIN drive.search_index si ON si.file_id = f.id
           WHERE si.file_id IS NULL OR {distinct}
           ORDER BY f.updated_at DESC
           LIMIT $1"#
    );
    let dirty = state.db.fetch_all_as::<File>(&sql, params![limit]).await?;

    let mut done = 0;
    for file in &dirty {
        if let Err(e) = index_one(state, http, file).await {
            tracing::warn!(file_id = %file.id, error = %e, "search: indexation fichier échouée");
        } else {
            done += 1;
        }
    }
    Ok(done)
}

/// Indexe (ou ré-indexe) un fichier unique.
pub async fn index_one(state: &AppState, http: &reqwest::Client, file: &File) -> anyhow::Result<()> {
    // 1. Content extraction (best-effort) + perceptual hash (dHash) for images.
    let mut content_text: Option<String> = None;
    let mut phash: Option<i64> = None;
    if let Ok(bytes) = state.storage.get(&file.storage_path).await {
        let buf = bytes.to_vec();
        if file.mime_type.starts_with("image/") {
            let b = buf.clone();
            phash = tokio::task::spawn_blocking(move || crate::services::phash::dhash(&b)).await.ok().flatten();
        }
        let mime = file.mime_type.clone();
        let name = file.name.clone();
        content_text = tokio::task::spawn_blocking(move || extract::extract_text(&mime, &name, &buf))
            .await
            .ok()
            .flatten();
    }

    // 2. Embedding optionnel (fail-open : toute erreur → pas de vecteur)
    let mut embedding: Option<Vec<f32>> = None;
    let mut embedding_dim: Option<i32> = None;
    if embeddings::is_enabled(&state.settings.embeddings) {
        let input = format!("{}\n{}", file.name, content_text.as_deref().unwrap_or(""));
        match embeddings::embed(http, &state.settings.embeddings, &input).await {
            Ok(v) => {
                embedding_dim = Some(v.len() as i32);
                embedding = Some(v);
            }
            Err(e) => tracing::debug!(file_id = %file.id, error = %e, "search: embedding ignoré"),
        }
    }

    // 3. Upsert (repli sans contenu si l'écriture avec contenu échoue).
    if let Err(e) = upsert(&state.db, file, content_text.as_deref(), &embedding, embedding_dim, phash).await {
        tracing::debug!(file_id = %file.id, error = %e, "search: upsert avec contenu échoué, repli nom seul");
        upsert(&state.db, file, None, &embedding, embedding_dim, phash).await?;
    }
    Ok(())
}

async fn upsert(
    db: &DbPool,
    file: &File,
    content_text: Option<&str>,
    embedding: &Option<Vec<f32>>,
    embedding_dim: Option<i32>,
    phash: Option<i64>,
) -> Result<(), sqlx::Error> {
    // Stems computed in Rust — the portable replacement for the tsvector trigger.
    let name_norm = kubuno_db::normalize(&file.name);
    let content_norm = kubuno_db::normalize(content_text.unwrap_or(""));
    // The embedding is a JSON array of floats (no REAL[] on MySQL/SQLite).
    let embedding_json: Option<serde_json::Value> = embedding.as_ref().map(|v| serde_json::json!(v));

    let b = db.backend();
    let clause = b.upsert(
        "drive.search_index",
        &["file_id"],
        &[
            Assign::Incoming("owner_id"),
            Assign::Incoming("name"),
            Assign::Incoming("mime_type"),
            Assign::Incoming("folder_id"),
            Assign::Incoming("content_text"),
            Assign::Incoming("name_norm"),
            Assign::Incoming("content_norm"),
            Assign::Incoming("embedding"),
            Assign::Incoming("embedding_dim"),
            Assign::Incoming("indexed_hash"),
            Assign::Incoming("is_trashed"),
            // Keep the existing phash when the new row does not carry one.
            Assign::Expr { col: "phash", expr: "COALESCE({new}, {cur})" },
            Assign::Incoming("indexed_at"),
        ],
    );
    let sql = format!(
        "INSERT INTO drive.search_index
            (file_id, owner_id, name, mime_type, folder_id, content_text, name_norm, content_norm,
             embedding, embedding_dim, indexed_hash, is_trashed, phash, indexed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14){clause}"
    );
    db.execute(
        &sql,
        params![
            file.id, file.owner_id, &file.name, &file.mime_type, file.folder_id, content_text,
            name_norm, content_norm, embedding_json, embedding_dim, file.content_hash.as_deref(),
            file.is_trashed, phash, chrono::Utc::now()
        ],
    )
    .await
    .map(|_| ())
}

/// Réconcilie les métadonnées des lignes indexées dont le **contenu est à jour**
/// mais dont le nom / dossier / type MIME / état corbeille a dérivé (renommage,
/// déplacement…). Recompute `name_norm` in Rust since there is no trigger. The
/// drifted rows are read, then updated one by one (portable; no `UPDATE ... FROM`).
pub async fn reconcile_metadata(db: &DbPool) -> Result<u64, sqlx::Error> {
    let b = db.backend();
    let hash_eq = null_safe_eq_cols(b, "si.indexed_hash", "f.content_hash");
    let name_ne = null_safe_distinct_cols(b, "si.name", "f.name");
    let folder_ne = null_safe_distinct_cols(b, "si.folder_id", "f.folder_id");
    let mime_ne = null_safe_distinct_cols(b, "si.mime_type", "f.mime_type");
    let trash_ne = null_safe_distinct_cols(b, "si.is_trashed", "f.is_trashed");
    let sql = format!(
        "SELECT si.file_id, f.name, f.folder_id, f.mime_type, f.is_trashed
         FROM drive.search_index si JOIN drive.files f ON si.file_id = f.id
         WHERE {hash_eq}
           AND ({name_ne} OR {folder_ne} OR {mime_ne} OR {trash_ne})"
    );
    let drifted = db.fetch_all_as::<DriftRow>(&sql, params![]).await?;
    let n = drifted.len() as u64;
    for d in &drifted {
        let name_norm = kubuno_db::normalize(&d.name);
        db.execute(
            "UPDATE drive.search_index
             SET name = $1, name_norm = $2, folder_id = $3, mime_type = $4, is_trashed = $5, indexed_at = $6
             WHERE file_id = $7",
            params![&d.name, name_norm, d.folder_id, &d.mime_type, d.is_trashed, chrono::Utc::now(), d.file_id],
        )
        .await?;
    }
    Ok(n)
}

/// Met à jour le miroir `is_trashed` de l'index (trash / restore).
pub async fn mark_trashed(db: &DbPool, file_id: Uuid, trashed: bool) {
    let _ = db
        .execute(
            "UPDATE drive.search_index SET is_trashed = $2 WHERE file_id = $1",
            params![file_id, trashed],
        )
        .await;
}

/// Réinitialise l'index d'un utilisateur (recalculé par le worker au prochain tick).
pub async fn reset_owner(db: &DbPool, owner_id: Uuid) -> Result<u64, sqlx::Error> {
    db.execute("DELETE FROM drive.search_index WHERE owner_id = $1", params![owner_id])
        .await
}
