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

#[derive(Debug, Deserialize)]
pub struct RecordOpenDto {
    pub file_id:   Uuid,
    pub module_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RecentQuery {
    pub module: Option<String>,
    pub limit:  Option<i64>,
}

/// Records that an app opened a file (centralised recent-files log).
pub async fn record_open(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Json(dto): Json<RecordOpenDto>,
) -> Result<Json<Value>> {
    // Only track files the user owns (foreign / missing ids are ignored).
    if files::get_file(&state.db, user.id, dto.file_id).await.is_ok() {
        access::record_open(&state.db, user.id, dto.file_id, dto.module_id.as_deref().unwrap_or("")).await?;
    }
    Ok(Json(json!({ "ok": true })))
}

/// Lists recently opened files (newest first), optionally filtered by app.
pub async fn list_recent(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Query(q): Query<RecentQuery>,
) -> Result<Json<Value>> {
    let files = access::list_recent(&state.db, user.id, q.module.as_deref(), q.limit.unwrap_or(30)).await?;
    Ok(Json(json!({ "recent": files })))
}

pub async fn remove_recent(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
) -> Result<Json<Value>> {
    access::remove_recent(&state.db, user.id, file_id).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn clear_recent(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
) -> Result<Json<Value>> {
    access::clear_recent(&state.db, user.id).await?;
    Ok(Json(json!({ "ok": true })))
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
