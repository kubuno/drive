use axum::{extract::State, Extension, Json};
use serde_json::Value;

use crate::{
    errors::Result,
    middleware::FilesUser,
    services::maintenance,
    state::AppState,
};

/// Trash usage stats for the current user (count, size, retention window).
pub async fn trash_stats(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
) -> Result<Json<Value>> {
    let stats = maintenance::trash_stats(&state.db, user.id).await?;
    Ok(Json(stats))
}
