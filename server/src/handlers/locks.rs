use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::Result,
    middleware::FilesUser,
    models::LockFileDto,
    services::locks,
    state::AppState,
};

pub async fn list(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
) -> Result<Json<Value>> {
    let locks = locks::list_locks(&state.db, user.id).await?;
    Ok(Json(json!({ "locks": locks })))
}

pub async fn get(
    State(state): State<AppState>,
    Extension(_user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let lock = locks::get_lock_info(&state.db, file_id).await?;
    Ok(Json(json!({ "lock": lock })))
}

pub async fn lock(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
    Json(dto): Json<LockFileDto>,
) -> Result<Json<Value>> {
    let lock = locks::lock_file(&state.db, user.id, file_id, dto.reason).await?;
    Ok(Json(json!({ "lock": lock })))
}

pub async fn unlock(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let is_admin = user.role == "admin";
    locks::unlock_file(&state.db, user.id, is_admin, file_id).await?;
    Ok(Json(json!({ "ok": true })))
}
