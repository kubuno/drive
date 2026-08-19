use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::Result,
    middleware::FilesUser,
    models::{CreateVersionDto, SetVersioningDto},
    services::versions,
    state::AppState,
};

pub async fn list(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let vs = versions::list_versions(&state.db, user.id, file_id).await?;
    Ok(Json(json!({ "versions": vs })))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
    Json(dto): Json<CreateVersionDto>,
) -> Result<Json<Value>> {
    let v = versions::create_version(&state.db, &state.storage, user.id, file_id, dto.comment, state.instance().max_file_versions).await?;
    Ok(Json(json!({ "version": v })))
}

pub async fn restore(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path((file_id, version_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let file = versions::restore_version(&state.db, &state.storage, user.id, file_id, version_id, state.instance().max_file_versions).await?;
    Ok(Json(json!({ "file": file })))
}

pub async fn delete(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path((file_id, version_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    versions::delete_version(&state.db, &state.storage, user.id, file_id, version_id).await?;
    Ok(Json(json!({ "ok": true })))
}

/// `DELETE /:id/versions` — drops the whole history, keeps the current file.
pub async fn purge(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let result = versions::purge_versions(&state.db, &state.storage, user.id, file_id).await?;
    crate::events::notify_change(&state.settings, user.id);
    Ok(Json(json!({
        "removed":     result.removed,
        "freed_bytes": result.freed_bytes,
    })))
}

/// `GET /versions/summary` — what the account's histories weigh in total.
pub async fn summary(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
) -> Result<Json<Value>> {
    let s = versions::versions_summary(&state.db, user.id).await?;
    Ok(Json(json!({
        "files_with_versions": s.files_with_versions,
        "total_versions":      s.total_versions,
        "total_bytes":         s.total_bytes,
    })))
}

pub async fn set_file_versioning(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
    Json(dto): Json<SetVersioningDto>,
) -> Result<Json<Value>> {
    let file = versions::set_file_versioning(&state.db, user.id, file_id, dto.enabled).await?;
    Ok(Json(json!({ "file": file })))
}

pub async fn set_folder_versioning(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(folder_id): Path<Uuid>,
    Json(dto): Json<SetVersioningDto>,
) -> Result<Json<Value>> {
    let folder = versions::set_folder_versioning(&state.db, user.id, folder_id, dto.enabled).await?;
    Ok(Json(json!({ "folder": folder })))
}
