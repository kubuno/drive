use axum::{
    extract::{Multipart, Query, State},
    Extension, Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::{
    errors::{FilesError, Result},
    middleware::FilesUser,
    services::{indexer, phash, search},
    state::AppState,
};

fn flag(qp: &HashMap<String, String>, k: &str) -> bool {
    matches!(qp.get(k).map(String::as_str), Some("true") | Some("1"))
}

/// GET /files/search — recherche plein-texte (+ sémantique si activé).
pub async fn search_files(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Query(qp): Query<HashMap<String, String>>,
) -> Result<Json<Value>> {
    let params = search::SearchParams {
        q:              qp.get("q").cloned().unwrap_or_default(),
        type_filter:    qp.get("type").cloned().unwrap_or_default(),
        owner:          qp.get("owner").cloned().unwrap_or_default(),
        date:           qp.get("date").cloned().unwrap_or_default(),
        trash:          flag(&qp, "trash"),
        starred:        flag(&qp, "starred"),
        item_name:      qp.get("item_name").cloned().unwrap_or_default(),
        contains_words: qp.get("contains_words").cloned().unwrap_or_default(),
        limit:          qp.get("limit").and_then(|v| v.parse().ok()).unwrap_or(20),
        offset:         qp.get("offset").and_then(|v| v.parse().ok()).unwrap_or(0),
    };

    let http = reqwest::Client::new();
    let (hits, total, semantic) = search::search(&state, &http, user.id, &params).await?;

    let results: Vec<Value> = hits
        .into_iter()
        .map(|h| {
            let mut v = serde_json::to_value(&h.file).unwrap_or_else(|_| json!({}));
            if let Value::Object(ref mut m) = v {
                m.insert("snippet".into(), json!(h.snippet));
                m.insert("score".into(), json!(h.score));
                m.insert("match_kind".into(), json!(h.match_kind));
                m.insert("folder_path".into(), json!(h.folder_path));
            }
            v
        })
        .collect();

    Ok(Json(json!({ "results": results, "total": total, "semantic": semantic })))
}

/// POST /files/search/similar — recherche d'images similaires à une image téléversée
/// (empreinte perceptuelle dHash → distance de Hamming).
pub async fn search_similar(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    mut multipart: Multipart,
) -> Result<Json<Value>> {
    let mut data: Option<Vec<u8>> = None;
    while let Some(field) = multipart.next_field().await
        .map_err(|e| FilesError::Validation(format!("multipart: {e}")))?
    {
        if field.name() == Some("image") {
            let b = field.bytes().await.map_err(|e| FilesError::Validation(format!("lecture image: {e}")))?;
            if b.len() as u64 > 40 * 1024 * 1024 {
                return Err(FilesError::Validation("Image trop volumineuse (max 40 Mo)".into()));
            }
            data = Some(b.to_vec());
        }
    }
    let bytes = data.ok_or_else(|| FilesError::Validation("Image manquante".into()))?;
    let qhash = phash::dhash(&bytes).ok_or_else(|| FilesError::Validation("Image illisible".into()))?;

    let (hits, total) = search::search_similar(&state, user.id, qhash, 60).await?;
    let results: Vec<Value> = hits
        .into_iter()
        .map(|h| {
            let mut v = serde_json::to_value(&h.file).unwrap_or_else(|_| json!({}));
            if let Value::Object(ref mut m) = v {
                m.insert("snippet".into(), json!(h.snippet));
                m.insert("score".into(), json!(h.score));
                m.insert("match_kind".into(), json!(h.match_kind));
                m.insert("folder_path".into(), json!(h.folder_path));
            }
            v
        })
        .collect();
    Ok(Json(json!({ "results": results, "total": total, "semantic": false })))
}

/// POST /files/search/reindex — purge l'index de l'utilisateur (reconstruit par le worker).
pub async fn reindex(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
) -> Result<Json<Value>> {
    let n = indexer::reset_owner(&state.db, user.id).await?;
    Ok(Json(json!({ "reset": n })))
}
