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
    models::CreateShareDto,
    services::shares,
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct RecipientQuery {
    #[serde(default)]
    pub q:     String,
    pub limit: Option<i64>,
}

pub async fn search_recipients(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Query(params): Query<RecipientQuery>,
) -> Result<Json<Value>> {
    let limit = params.limit.unwrap_or(10);
    let recipients = shares::search_recipients(&state.db, user.id, &params.q, limit).await?;
    Ok(Json(json!({ "recipients": recipients })))
}

pub async fn list(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
) -> Result<Json<Value>> {
    let items = shares::list_shares(&state.db, user.id).await?;
    Ok(Json(json!({ "shares": items })))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Json(dto): Json<CreateShareDto>,
) -> Result<Json<Value>> {
    let share = shares::create_share(&state.db, user.id, dto).await?;
    Ok(Json(json!({ "share": share })))
}

pub async fn revoke(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(share_id): Path<Uuid>,
) -> Result<Json<Value>> {
    shares::revoke_share(&state.db, user.id, share_id).await?;
    Ok(Json(json!({ "ok": true })))
}
