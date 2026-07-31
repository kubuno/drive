use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::Result,
    middleware::FilesUser,
    models::CreatePdfCommentDto,
    services::comments,
    state::AppState,
};

/// GET /:id/comments — anchored comments on a document the user can read.
pub async fn list(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
) -> Result<Json<Value>> {
    comments::assert_readable(&state.db, user.id, file_id).await?;
    let list = comments::list_comments(&state.db, file_id).await?;
    Ok(Json(json!({ "comments": list })))
}

/// POST /:id/comments — add a comment anchored to a page region.
pub async fn create(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
    Json(dto): Json<CreatePdfCommentDto>,
) -> Result<Json<Value>> {
    comments::assert_readable(&state.db, user.id, file_id).await?;
    let comment = comments::create_comment(&state.db, user.id, file_id, dto).await?;
    Ok(Json(json!({ "comment": comment })))
}

#[derive(Debug, Deserialize)]
pub struct ResolveDto {
    pub resolved: bool,
}

/// PATCH /comments/:cid/resolve — mark a comment resolved / reopened.
pub async fn resolve(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(comment_id): Path<Uuid>,
    Json(dto): Json<ResolveDto>,
) -> Result<Json<Value>> {
    let is_admin = user.role == "admin";
    let comment = comments::set_resolved(&state.db, user.id, is_admin, comment_id, dto.resolved).await?;
    Ok(Json(json!({ "comment": comment })))
}

/// DELETE /comments/:cid — remove a comment (author or admin).
pub async fn delete(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(comment_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let is_admin = user.role == "admin";
    comments::delete_comment(&state.db, user.id, is_admin, comment_id).await?;
    Ok(Json(json!({ "ok": true })))
}
