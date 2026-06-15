//! Pipeline d'indexation de recherche : détecte les fichiers « sales » (jamais indexés
//! ou dont le contenu a changé), extrait le texte, calcule l'embedding si activé, et
//! met à jour `drive.search_index`. La même détection sert au backfill initial.

use crate::models::file::File;
use crate::services::{embeddings, extract};
use crate::state::AppState;
use sqlx::PgPool;
use std::time::Duration;
use uuid::Uuid;

const TICK: Duration = Duration::from_secs(15);
const BATCH: i64 = 20;

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
        // Réconciliation des métadonnées (renommage, déplacement, corbeille) : auto-guérit
        // toute dérive sans relire le contenu, même si aucun hook n'a été déclenché.
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
    let dirty = sqlx::query_as::<_, File>(
        r#"SELECT f.* FROM drive.files f
           LEFT JOIN drive.search_index si ON si.file_id = f.id
           WHERE si.file_id IS NULL OR si.indexed_hash IS DISTINCT FROM f.content_hash
           ORDER BY f.updated_at DESC
           LIMIT $1"#,
    )
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

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
    // 1. Extraction de contenu (best-effort ; remote/manquant → nom seulement) +
    //    empreinte perceptuelle (dHash) pour les images → recherche d'images similaires.
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

    // 3. Upsert (repli sans contenu si la tsvector dépasse les limites)
    if let Err(e) = upsert(&state.db, file, content_text.as_deref(), &embedding, embedding_dim, phash).await {
        tracing::debug!(file_id = %file.id, error = %e, "search: upsert avec contenu échoué, repli nom seul");
        upsert(&state.db, file, None, &embedding, embedding_dim, phash).await?;
    }
    Ok(())
}

async fn upsert(
    db: &PgPool,
    file: &File,
    content_text: Option<&str>,
    embedding: &Option<Vec<f32>>,
    embedding_dim: Option<i32>,
    phash: Option<i64>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO drive.search_index
             (file_id, owner_id, name, mime_type, folder_id, content_text, embedding, embedding_dim, indexed_hash, is_trashed, phash, indexed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())
           ON CONFLICT (file_id) DO UPDATE SET
             owner_id=EXCLUDED.owner_id, name=EXCLUDED.name, mime_type=EXCLUDED.mime_type,
             folder_id=EXCLUDED.folder_id, content_text=EXCLUDED.content_text,
             embedding=EXCLUDED.embedding, embedding_dim=EXCLUDED.embedding_dim,
             indexed_hash=EXCLUDED.indexed_hash, is_trashed=EXCLUDED.is_trashed,
             phash=COALESCE(EXCLUDED.phash, drive.search_index.phash), indexed_at=NOW()"#,
    )
    .bind(file.id)
    .bind(file.owner_id)
    .bind(&file.name)
    .bind(&file.mime_type)
    .bind(file.folder_id)
    .bind(content_text)
    .bind(embedding.as_deref())
    .bind(embedding_dim)
    .bind(&file.content_hash)
    .bind(file.is_trashed)
    .bind(phash)
    .execute(db)
    .await
    .map(|_| ())
}

/// Réconcilie les métadonnées des lignes déjà indexées dont le **contenu est à jour**
/// (`indexed_hash` = `content_hash`) mais dont le nom, le dossier, le type MIME ou l'état
/// corbeille a dérivé — typiquement après un renommage ou un déplacement, qui ne changent
/// pas le hash du contenu et échappent donc à `index_batch`.
///
/// Une seule requête, sans accès au stockage. L'`UPDATE` de `name` re-déclenche le trigger
/// `tsv` (reconstruit à partir du `content_text` déjà stocké) → recherche par nouveau nom
/// correcte. L'embedding n'est volontairement pas recalculé (apport du nom négligeable).
/// Renvoie le nombre de lignes corrigées.
pub async fn reconcile_metadata(db: &PgPool) -> Result<u64, sqlx::Error> {
    let r = sqlx::query(
        r#"UPDATE drive.search_index si
           SET name       = f.name,
               folder_id  = f.folder_id,
               mime_type  = f.mime_type,
               is_trashed = f.is_trashed,
               indexed_at = NOW()
           FROM drive.files f
           WHERE si.file_id = f.id
             AND si.indexed_hash IS NOT DISTINCT FROM f.content_hash
             AND ( si.name       IS DISTINCT FROM f.name
                OR si.folder_id  IS DISTINCT FROM f.folder_id
                OR si.mime_type  IS DISTINCT FROM f.mime_type
                OR si.is_trashed IS DISTINCT FROM f.is_trashed )"#,
    )
    .execute(db)
    .await?;
    Ok(r.rows_affected())
}

/// Met à jour le miroir `is_trashed` de l'index (trash / restore).
pub async fn mark_trashed(db: &PgPool, file_id: Uuid, trashed: bool) {
    let _ = sqlx::query("UPDATE drive.search_index SET is_trashed = $2 WHERE file_id = $1")
        .bind(file_id)
        .bind(trashed)
        .execute(db)
        .await;
}

/// Réinitialise l'index d'un utilisateur (recalculé par le worker au prochain tick).
pub async fn reset_owner(db: &PgPool, owner_id: Uuid) -> Result<u64, sqlx::Error> {
    let r = sqlx::query("DELETE FROM drive.search_index WHERE owner_id = $1")
        .bind(owner_id)
        .execute(db)
        .await?;
    Ok(r.rows_affected())
}
