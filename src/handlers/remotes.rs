//! Montages distants — le BACKEND est centralisé dans le core. Ces handlers ne
//! font que **proxifier** `/api/v1/drive/remotes/*` vers les routes internes du
//! core `/internal/storage/mounts/:user_id/*` (X-Internal-Secret + user_id).
//! Cf. [[project_storage_centralization]].

use axum::{
    body::Body,
    extract::{Extension, Path, State},
    http::{header::{CONTENT_DISPOSITION, CONTENT_TYPE}, Method, StatusCode},
    response::Response,
    Json,
};
use serde_json::Value;
use uuid::Uuid;

use crate::{errors::FilesError, middleware::FilesUser, state::AppState};

fn err(e: impl std::fmt::Display) -> FilesError {
    FilesError::Internal(anyhow::anyhow!(e.to_string()))
}

/// Encode chaque segment d'un chemin (octets UTF-8 → %XX), en préservant les `/`.
fn enc_path(p: &str) -> String {
    fn enc_seg(seg: &str) -> String {
        seg.bytes().map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        }).collect()
    }
    p.trim_start_matches('/').split('/').map(enc_seg).collect::<Vec<_>>().join("/")
}

async fn forward_json(state: &AppState, method: Method, path: &str, body: Option<Value>) -> Result<Response, FilesError> {
    let url = format!("{}{}", state.settings.core.url.trim_end_matches('/'), path);
    let mut req = reqwest::Client::new()
        .request(method, &url)
        .header("X-Internal-Secret", &state.settings.core.internal_secret);
    if let Some(b) = body { req = req.json(&b); }
    let resp = req.send().await.map_err(err)?;

    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let ct = resp.headers().get(CONTENT_TYPE).cloned();
    let bytes = resp.bytes().await.map_err(err)?;
    let mut builder = Response::builder().status(status);
    if let Some(ct) = ct { builder = builder.header(CONTENT_TYPE, ct); }
    builder.body(Body::from(bytes)).map_err(err)
}

async fn forward_stream(state: &AppState, path: &str) -> Result<Response, FilesError> {
    let url = format!("{}{}", state.settings.core.url.trim_end_matches('/'), path);
    let resp = reqwest::Client::new()
        .get(&url)
        .header("X-Internal-Secret", &state.settings.core.internal_secret)
        .send().await.map_err(err)?;

    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let headers = resp.headers().clone();
    let mut builder = Response::builder().status(status);
    for h in [CONTENT_TYPE, CONTENT_DISPOSITION] {
        if let Some(v) = headers.get(&h) { builder = builder.header(h, v); }
    }
    builder.body(Body::from_stream(resp.bytes_stream())).map_err(err)
}

// ── Handlers (proxy) ──────────────────────────────────────────────────────────

pub async fn list_connections(State(state): State<AppState>, Extension(user): Extension<FilesUser>) -> Result<Response, FilesError> {
    forward_json(&state, Method::GET, &format!("/internal/storage/mounts/{}", user.id), None).await
}

pub async fn create_connection(State(state): State<AppState>, Extension(user): Extension<FilesUser>, Json(dto): Json<Value>) -> Result<Response, FilesError> {
    forward_json(&state, Method::POST, &format!("/internal/storage/mounts/{}", user.id), Some(dto)).await
}

pub async fn delete_connection(State(state): State<AppState>, Extension(user): Extension<FilesUser>, Path(id): Path<Uuid>) -> Result<Response, FilesError> {
    forward_json(&state, Method::DELETE, &format!("/internal/storage/mounts/{}/{}", user.id, id), None).await
}

pub async fn test_connection(State(state): State<AppState>, Extension(user): Extension<FilesUser>, Path(id): Path<Uuid>) -> Result<Response, FilesError> {
    forward_json(&state, Method::POST, &format!("/internal/storage/mounts/{}/{}/test", user.id, id), None).await
}

pub async fn list_remote_root(State(state): State<AppState>, Extension(user): Extension<FilesUser>, Path(id): Path<Uuid>) -> Result<Response, FilesError> {
    forward_json(&state, Method::GET, &format!("/internal/storage/mounts/{}/{}/browse", user.id, id), None).await
}

pub async fn list_remote_dir(State(state): State<AppState>, Extension(user): Extension<FilesUser>, Path((id, path)): Path<(Uuid, String)>) -> Result<Response, FilesError> {
    forward_json(&state, Method::GET, &format!("/internal/storage/mounts/{}/{}/browse/{}", user.id, id, enc_path(&path)), None).await
}

pub async fn get_remote_file(State(state): State<AppState>, Extension(user): Extension<FilesUser>, Path((id, path)): Path<(Uuid, String)>) -> Result<Response, FilesError> {
    forward_stream(&state, &format!("/internal/storage/mounts/{}/{}/file/{}", user.id, id, enc_path(&path))).await
}

pub async fn delete_remote_entry(State(state): State<AppState>, Extension(user): Extension<FilesUser>, Path((id, path)): Path<(Uuid, String)>) -> Result<Response, FilesError> {
    forward_json(&state, Method::DELETE, &format!("/internal/storage/mounts/{}/{}/entry/{}", user.id, id, enc_path(&path)), None).await
}

pub async fn rename_remote_entry(State(state): State<AppState>, Extension(user): Extension<FilesUser>, Path((id, path)): Path<(Uuid, String)>, Json(dto): Json<Value>) -> Result<Response, FilesError> {
    forward_json(&state, Method::POST, &format!("/internal/storage/mounts/{}/{}/rename/{}", user.id, id, enc_path(&path)), Some(dto)).await
}

pub async fn create_remote_dir(State(state): State<AppState>, Extension(user): Extension<FilesUser>, Path((id, path)): Path<(Uuid, String)>) -> Result<Response, FilesError> {
    forward_json(&state, Method::POST, &format!("/internal/storage/mounts/{}/{}/mkdir/{}", user.id, id, enc_path(&path)), None).await
}

pub async fn upload_remote(State(state): State<AppState>, Extension(user): Extension<FilesUser>, Path((id, path)): Path<(Uuid, String)>, body: Body) -> Result<Response, FilesError> {
    let url = format!("{}/internal/storage/mounts/{}/{}/upload/{}",
        state.settings.core.url.trim_end_matches('/'), user.id, id, enc_path(&path));
    let resp = reqwest::Client::new()
        .post(&url)
        .header("X-Internal-Secret", &state.settings.core.internal_secret)
        .body(reqwest::Body::wrap_stream(body.into_data_stream()))
        .send().await.map_err(err)?;
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let bytes = resp.bytes().await.map_err(err)?;
    Response::builder().status(status)
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(bytes)).map_err(err)
}
