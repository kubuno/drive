/// Routes publiques — accès à un partage par token (sans authentification).
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::Response,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    errors::{FilesError, Result},
    services::{files, shares},
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct ShareAccessQuery {
    pub password: Option<String>,
}

pub async fn get_share_info(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Query(q): Query<ShareAccessQuery>,
) -> Result<Json<Value>> {
    let share = shares::get_share_by_token(&state.db, &token).await?;
    let password_protected = share.password_hash.is_some();
    let unlocked = shares::share_password_ok(&share, q.password.as_deref());

    // Resolve the target's display name and, for files, lightweight metadata.
    let (item_name, item_kind, size_bytes, mime_type) = if let Some(file_id) = share.file_id {
        let file = files::get_file_any_owner(&state.db, file_id).await?;
        (file.name, "file", Some(file.size_bytes), Some(file.mime_type))
    } else if let Some(folder_id) = share.folder_id {
        let name: Option<String> =
            sqlx::query_scalar("SELECT name FROM drive.folders WHERE id = $1")
                .bind(folder_id)
                .fetch_optional(&state.db)
                .await?;
        (name.unwrap_or_else(|| "Dossier".into()), "folder", None, None)
    } else {
        return Err(FilesError::NotFound("Partage invalide".into()));
    };

    // Never expose password_hash; surface only a boolean and the unlock state.
    Ok(Json(json!({
        "share": {
            "token":              share.token,
            "item_name":          item_name,
            "item_kind":          item_kind,
            "size_bytes":         size_bytes,
            "mime_type":          mime_type,
            "can_download":       share.can_download,
            "password_protected": password_protected,
            "unlocked":           unlocked,
            "expires_at":         share.expires_at,
            "download_count":     share.download_count,
            "max_downloads":      share.max_downloads,
        }
    })))
}

pub async fn download_shared(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Query(q): Query<ShareAccessQuery>,
) -> Result<Response> {
    let share = shares::get_share_by_token(&state.db, &token).await?;

    if !share.can_download {
        return Err(FilesError::Forbidden);
    }
    // Enforce password protection before serving any bytes.
    if !shares::share_password_ok(&share, q.password.as_deref()) {
        return Err(FilesError::Unauthorized);
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
