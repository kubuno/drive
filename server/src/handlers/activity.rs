use axum::{extract::{Path, Query, State}, Extension, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::Result,
    middleware::FilesUser,
    services::activity,
    state::AppState,
};

pub async fn file_activity(
    State(state): State<AppState>,
    Extension(_user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let entries = activity::list_file_activity(&state.db, file_id).await?;
    Ok(Json(json!({ "activities": entries })))
}

/// Account-wide activity feed (Drive home → "Activity" tab).
pub async fn user_activity(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Query(q): Query<ActivityQuery>,
) -> Result<Json<Value>> {
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let entries = activity::list_user_activity(&state.db, user.id, limit).await?;
    Ok(Json(json!({ "activities": entries })))
}

#[derive(Debug, Deserialize)]
pub struct ActivityQuery {
    pub limit: Option<i64>,
}

pub async fn folder_activity(
    State(state): State<AppState>,
    Extension(_user): Extension<FilesUser>,
    Path(folder_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let entries = activity::list_folder_activity(&state.db, folder_id).await?;
    Ok(Json(json!({ "activities": entries })))
}

pub async fn file_info_extra(
    State(state): State<AppState>,
    Extension(_user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let owner  = activity::get_file_owner(&state.db, file_id).await?;
    let access = activity::list_file_access(&state.db, file_id).await?;
    Ok(Json(json!({ "owner": owner, "access": access })))
}

pub async fn folder_info_extra(
    State(state): State<AppState>,
    Extension(_user): Extension<FilesUser>,
    Path(folder_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let owner  = activity::get_folder_owner(&state.db, folder_id).await?;
    let access = activity::list_folder_access(&state.db, folder_id).await?;
    Ok(Json(json!({ "owner": owner, "access": access })))
}
