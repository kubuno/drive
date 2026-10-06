//! Idempotency for mutating drive requests.
//!
//! Mirrors the core's idempotency layer, but lives in the drive because drive
//! routes are proxied and never reach the core middleware. A mutating request
//! carrying `Idempotency-Key` runs once; its successful response is stored and
//! replayed for any later request with the same (user, method, path, key) —
//! so an offline client replaying a queued upload can't create a duplicate.

use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use chrono::{Duration, Utc};
use sha2::{Digest, Sha256};

use crate::state::AppState;

const MAX_CACHED_BODY: usize = 4 * 1024 * 1024; // 4 MB — drive write responses are small JSON
const TTL_HOURS: i64 = 24;

/// The stored response replayed for a repeated idempotency key.
#[derive(sqlx::FromRow)]
struct CachedResponse {
    status_code: i32,
    content_type: Option<String>,
    body: Vec<u8>,
}

fn sha256_hex(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}

pub async fn idempotency(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let method = req.method().clone();
    if !matches!(
        method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    ) {
        return next.run(req).await;
    }

    let key = match req.headers().get("idempotency-key").and_then(|v| v.to_str().ok()) {
        Some(k) if !k.is_empty() => k.to_string(),
        _ => return next.run(req).await,
    };

    // Scope per user (injected by the core proxy). No user id → no scoping → skip.
    let user_id = match req
        .headers()
        .get("x-kubuno-user-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| uuid::Uuid::parse_str(s).ok())
    {
        Some(u) => u,
        None => return next.run(req).await,
    };

    let path = req.uri().path().to_string();
    let id_hash = sha256_hex(&format!("{user_id}|{method}|{path}|{key}"));

    match state
        .db
        .fetch_optional_as::<CachedResponse>(
            "SELECT status_code, content_type, body FROM drive.idempotency_keys
             WHERE id_hash = $1 AND expires_at > $2",
            kubuno_db::params![&id_hash, Utc::now()],
        )
        .await
    {
        Ok(Some(CachedResponse { status_code: status, content_type: ctype, body })) => {
            let status = StatusCode::from_u16(status as u16).unwrap_or(StatusCode::OK);
            let mut builder = axum::http::Response::builder()
                .status(status)
                .header("idempotency-replayed", "true");
            if let Some(ct) = ctype {
                builder = builder.header(header::CONTENT_TYPE, ct);
            }
            return builder
                .body(Body::from(body))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
        }
        Ok(None) => {}
        Err(e) => {
            tracing::error!(error = %e, "Lecture drive.idempotency_keys échouée");
            return next.run(req).await;
        }
    }

    let resp = next.run(req).await;
    let (parts, body) = resp.into_parts();
    let bytes = match axum::body::to_bytes(body, MAX_CACHED_BODY).await {
        Ok(b) => b,
        Err(_) => {
            tracing::warn!(path = %path, "Réponse trop volumineuse pour l'idempotence");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    if parts.status.is_success() {
        let ctype = parts
            .headers
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let expires = Utc::now() + Duration::hours(TTL_HOURS);
        let b = state.db.backend();
        let sql = format!(
            "INSERT {}INTO drive.idempotency_keys
                (id_hash, user_id, method, path, status_code, content_type, body, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8){}",
            b.insert_ignore_prefix(),
            b.on_conflict_do_nothing(&["id_hash"]),
        );
        if let Err(e) = state
            .db
            .execute(
                &sql,
                kubuno_db::params![
                    &id_hash,
                    user_id,
                    method.as_str(),
                    &path,
                    parts.status.as_u16() as i32,
                    ctype,
                    bytes.as_ref(),
                    expires
                ],
            )
            .await
        {
            tracing::error!(error = %e, "Écriture drive.idempotency_keys échouée");
        }
    }

    Response::from_parts(parts, Body::from(bytes))
}
