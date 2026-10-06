use axum::{
    extract::{Request, State},
    middleware::Next,
    response::Response,
};
use uuid::Uuid;

use crate::{errors::FilesError, state::AppState};

pub mod idempotency;

/// Guard of the `/ipc/*` routes (module-to-module calls and operator actions such
/// as `/ipc/scan`): the caller must present this module's internal secret in
/// `X-Internal-Secret`. An **empty** configured secret refuses everything (a
/// module started outside the supervisor would otherwise accept an empty header),
/// and the comparison is constant-time.
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

    if !internal_secret_matches(&state.settings.core.internal_secret, provided) {
        return Err(FilesError::Unauthorized);
    }
    Ok(next.run(req).await)
}

/// Whether `provided` is the configured internal secret. Never true for an empty
/// configured secret. Constant-time in the content (the length is not a secret).
pub fn internal_secret_matches(expected: &str, provided: &str) -> bool {
    if expected.is_empty() {
        tracing::error!("drive: core.internal_secret is empty; internal route refused");
        return false;
    }
    let (a, b) = (expected.as_bytes(), provided.as_bytes());
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
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

#[cfg(test)]
mod ipc_secret_tests {
    use super::internal_secret_matches;

    #[test]
    fn only_the_configured_secret_passes() {
        assert!(internal_secret_matches("s3cret-value", "s3cret-value"));
        assert!(!internal_secret_matches("s3cret-value", "s3cret-valuX"));
        assert!(!internal_secret_matches("s3cret-value", "s3cret"));
        assert!(!internal_secret_matches("s3cret-value", ""));
    }

    #[test]
    fn an_empty_configured_secret_refuses_everything() {
        assert!(!internal_secret_matches("", ""));
        assert!(!internal_secret_matches("", "anything"));
    }
}
