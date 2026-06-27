//! Delta sync endpoints consumed by native/desktop clients.

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::HeaderMap,
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::Result,
    middleware::FilesUser,
    services::sync,
    state::AppState,
};

#[derive(Deserialize)]
pub struct DeltaQuery {
    /// Last `change_seq` seen by the client. 0 (default) returns a full snapshot.
    pub cursor: Option<i64>,
    pub limit:  Option<i64>,
    /// `full=true` → chaque change embarque le modèle complet `file`/`folder`
    /// (en plus du sous-ensemble), pour un store local byte-compatible (drive-core).
    pub full:   Option<bool>,
}

/// GET /sync/delta?cursor=&limit= — changes since the cursor (files, folders, deletions).
pub async fn delta(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Query(q): Query<DeltaQuery>,
) -> Result<Json<Value>> {
    let cursor = q.cursor.unwrap_or(0).max(0);
    let limit = q.limit.unwrap_or(500).clamp(1, 2000);
    let full = q.full.unwrap_or(false);

    let delta = sync::delta(&state.db, user.id, cursor, limit, full).await?;

    Ok(Json(json!({
        "changes":  delta.changes,
        "cursor":   delta.cursor,
        "has_more": delta.has_more,
    })))
}

/// PUT /sync/file/:id/content — replace a file's content (raw body).
///
/// Send `If-Match: <etag>` to push a local edit safely: if the server's content
/// changed meanwhile, the request fails with 412 and the client resolves the
/// conflict locally. Returns the new etag.
pub async fn put_content(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>> {
    let if_match = headers
        .get("if-match")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim_matches('"'))
        .filter(|s| !s.is_empty());

    let file = sync::replace_content(&state.db, &state.storage, user.id, file_id, body, if_match).await?;

    crate::events::notify_change(&state.settings, user.id);

    Ok(Json(json!({
        "id":   file.id,
        "etag": file.content_hash,
        "size": file.size_bytes,
    })))
}
