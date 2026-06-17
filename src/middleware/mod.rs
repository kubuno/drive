use axum::{
    extract::{Request, State},
    middleware::Next,
    response::Response,
};
use uuid::Uuid;

use crate::{errors::FilesError, state::AppState};

pub mod idempotency;

/// Middleware IPC : valide X-Internal-Secret pour les appels inter-modules.
pub async fn require_ipc_secret(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> std::result::Result<Response, FilesError> {
    let provided = req
        .headers()
        .get("x-internal-secret")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if provided != state.settings.core.internal_secret {
        return Err(FilesError::Unauthorized);
    }
    Ok(next.run(req).await)
}

/// Utilisateur extrait des headers injectés par le core.
#[derive(Debug, Clone)]
pub struct FilesUser {
    pub id:    Uuid,
    pub role:  String,
    pub email: String,
}

/// Clé d'extension Axum pour stocker l'utilisateur dans la requête.
pub type FilesUserExt = axum::Extension<FilesUser>;

/// Middleware : extrait X-Kubuno-User-Id, X-Kubuno-User-Role, X-Kubuno-User-Email.
/// Ces headers sont injectés par le proxy du core — on leur fait confiance.
pub async fn require_auth(
    State(_state): State<AppState>,
    mut req: Request,
    next: Next,
) -> std::result::Result<Response, FilesError> {
    let user_id = req
        .headers()
        .get("x-kubuno-user-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or(FilesError::Unauthorized)?;

    let role = req
        .headers()
        .get("x-kubuno-user-role")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("user")
        .to_string();

    let email = req
        .headers()
        .get("x-kubuno-user-email")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    req.extensions_mut().insert(FilesUser { id: user_id, role, email });
    Ok(next.run(req).await)
}
