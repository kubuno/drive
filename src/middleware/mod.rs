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

/// This module's id, used as the token audience: a token minted for another
/// module does not validate here.
const MODULE_ID: &str = "drive";

/// Middleware: authenticate the caller from the signed `X-Kubuno-Auth` token the
/// core mints with this module's internal secret (see `kubuno-modauth`).
///
/// The plain `X-Kubuno-User-*` headers are no longer trusted: any process able
/// to reach this module's loopback port could set them to impersonate any user,
/// administrators included. The token binds the identity to the module secret
/// and carries a short expiry, so a forged or replayed header is rejected.
pub async fn require_auth(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> std::result::Result<Response, FilesError> {
    let token = req
        .headers()
        .get(kubuno_modauth::TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
        .ok_or(FilesError::Unauthorized)?;

    let user = kubuno_modauth::verify(
        state.settings.core.internal_secret.as_bytes(),
        token,
        MODULE_ID,
    )
    .map_err(|_| FilesError::Unauthorized)?;

    req.extensions_mut().insert(FilesUser {
        id: user.id,
        role: user.role,
        email: user.email,
    });
    Ok(next.run(req).await)
}
