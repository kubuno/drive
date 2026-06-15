/// Routes publiques — accès à un partage par token (sans authentification).
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, StatusCode},
    response::Response,
    Json,
};
use serde_json::{json, Value};

use crate::{
    errors::{FilesError, Result},
    services::{files, shares},
    state::AppState,
};

pub async fn get_share_info(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<Value>> {
    let share = shares::get_share_by_token(&state.db, &token).await?;
    Ok(Json(json!({ "share": share })))
}

pub async fn download_shared(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Response> {
    let share = shares::get_share_by_token(&state.db, &token).await?;

    if !share.can_download {
        return Err(FilesError::Forbidden);
    }

    let file_id = share.file_id.ok_or_else(|| {
        FilesError::Validation("Ce lien partage un dossier, pas un fichier".into())
    })?;

    let file = files::get_file_any_owner(&state.db, file_id).await?;
    let data = state.storage.get(&file.storage_path).await?;

    shares::increment_download_count(&state.db, share.id).await?;

    let disposition = format!(
        "attachment; filename=\"{}\"",
        file.name.replace('"', "\\\"")
    );

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, &file.mime_type)
        .header(header::CONTENT_DISPOSITION, disposition)
        .header(header::CONTENT_LENGTH, data.len())
        .body(Body::from(data))
        .expect("valid response"))
}
