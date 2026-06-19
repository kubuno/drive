use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::Result,
    middleware::FilesUser,
    services::{access, files},
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct FrequentQuery {
    pub limit: Option<i64>,
}

/// Records a view. Ownership is enforced via get_file; foreign files are ignored.
pub async fn record_view(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
) -> Result<Json<Value>> {
    if files::get_file(&state.db, user.id, file_id).await.is_ok() {
        access::record_view(&state.db, file_id, user.id).await?;
    }
    Ok(Json(json!({ "ok": true })))
}

pub async fn get_access(
    State(state): State<AppState>,
    Extension(_user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let stats = access::get_access(&state.db, file_id).await?;
    Ok(Json(json!({ "access": stats })))
}

pub async fn frequent(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Query(q): Query<FrequentQuery>,
) -> Result<Json<Value>> {
    let files = access::frequent(&state.db, user.id, q.limit.unwrap_or(12)).await?;
    Ok(Json(json!({ "files": files })))
}
