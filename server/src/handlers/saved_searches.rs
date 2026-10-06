use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::Result,
    middleware::FilesUser,
    models::{CreateSavedSearchDto, UpdateSavedSearchDto},
    services::saved_searches,
    state::AppState,
};

pub async fn list(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
) -> Result<Json<Value>> {
    let searches = saved_searches::list(&state.db, user.id).await?;
    Ok(Json(json!({ "searches": searches })))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Json(dto): Json<CreateSavedSearchDto>,
) -> Result<Json<Value>> {
    let search = saved_searches::create(&state.db, user.id, dto).await?;
    Ok(Json(json!({ "search": search })))
}

pub async fn update(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(id): Path<Uuid>,
    Json(dto): Json<UpdateSavedSearchDto>,
) -> Result<Json<Value>> {
    let search = saved_searches::update(&state.db, user.id, id, dto).await?;
    Ok(Json(json!({ "search": search })))
}

pub async fn delete(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    saved_searches::delete(&state.db, user.id, id).await?;
    Ok(Json(json!({ "ok": true })))
}
