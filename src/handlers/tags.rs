use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::Result,
    middleware::FilesUser,
    models::{AssignTagDto, CreateTagDto, UpdateTagDto},
    services::tags,
    state::AppState,
};

pub async fn list(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
) -> Result<Json<Value>> {
    let tags = tags::list_tags(&state.db, user.id).await?;
    // Ship the full assignment map alongside, so the UI paints badges in one fetch.
    let assignments = tags::list_assignments(&state.db, user.id).await?;
    Ok(Json(json!({ "tags": tags, "assignments": assignments })))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Json(dto): Json<CreateTagDto>,
) -> Result<Json<Value>> {
    let tag = tags::create_tag(&state.db, user.id, dto).await?;
    Ok(Json(json!({ "tag": tag })))
}

pub async fn update(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(tag_id): Path<Uuid>,
    Json(dto): Json<UpdateTagDto>,
) -> Result<Json<Value>> {
    let tag = tags::update_tag(&state.db, user.id, tag_id, dto).await?;
    Ok(Json(json!({ "tag": tag })))
}

pub async fn delete(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(tag_id): Path<Uuid>,
) -> Result<Json<Value>> {
    tags::delete_tag(&state.db, user.id, tag_id).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn assignments(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
) -> Result<Json<Value>> {
    let assignments = tags::list_assignments(&state.db, user.id).await?;
    Ok(Json(json!({ "assignments": assignments })))
}

pub async fn tag_items(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(tag_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let files = tags::list_files_by_tag(&state.db, user.id, tag_id).await?;
    let folders = tags::list_folders_by_tag(&state.db, user.id, tag_id).await?;
    Ok(Json(json!({ "files": files, "folders": folders })))
}

pub async fn assign_file(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
    Json(dto): Json<AssignTagDto>,
) -> Result<Json<Value>> {
    tags::assign_file_tag(&state.db, user.id, file_id, dto.tag_id).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn unassign_file(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path((file_id, tag_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    tags::remove_file_tag(&state.db, user.id, file_id, tag_id).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn assign_folder(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(folder_id): Path<Uuid>,
    Json(dto): Json<AssignTagDto>,
) -> Result<Json<Value>> {
    tags::assign_folder_tag(&state.db, user.id, folder_id, dto.tag_id).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn unassign_folder(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path((folder_id, tag_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    tags::remove_folder_tag(&state.db, user.id, folder_id, tag_id).await?;
    Ok(Json(json!({ "ok": true })))
}
