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

/// The two instance switches this surface enforces LIVE, on every request,
/// rather than only at creation time. Turning public links off, or forbidding
/// download through them, has to close the links already handed out — a policy
/// that only applies to tomorrow's links leaves yesterday's exposure intact,
/// which is the opposite of what an administrator reaches for the switch to do.
fn public_access_denied(state: &AppState) -> Option<FilesError> {
    (!state.instance().public_links_enabled).then(|| {
        FilesError::NotFound("Partage introuvable ou expiré".into())
    })
}

pub async fn get_share_info(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Query(q): Query<ShareAccessQuery>,
) -> Result<Json<Value>> {
    // Answered as "not found", never as "disabled": an anonymous visitor must
    // not learn from us that a token is valid but administratively closed.
    if let Some(err) = public_access_denied(&state) {
        return Err(err);
    }
    let share = shares::get_share_by_token(&state.db, &token).await?;
    let password_protected = share.password_hash.is_some();
    // The live policy can withdraw a permission the row still carries.
    let can_download = share.can_download && state.instance().share_public_download_enabled;
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
            "can_download":       can_download,
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
    if let Some(err) = public_access_denied(&state) {
        return Err(err);
    }
    let share = shares::get_share_by_token(&state.db, &token).await?;

    if !share.can_download {
        return Err(FilesError::Forbidden);
    }
    if !state.instance().share_public_download_enabled {
        return Err(FilesError::PolicyDisabled(
            "Le téléchargement par lien public est désactivé sur cette instance".into(),
        ));
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
