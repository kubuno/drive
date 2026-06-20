//! Generic canonical-path resolver. A module sends drive a path of the form
//! `[<storage>]/<rel>` and drive routes it to the right backend:
//!   - `[Drive]/<rel>`   → the requesting user's own Drive (local DB + storage)
//!   - `[<mount>]/<rel>` → the remote mount named `<mount>` (proxied to the core)
//!
//! This is the single entry point other modules use to read a directory or a
//! file without knowing where it physically lives. Both endpoints return paths
//! back in the same canonical form so callers can keep navigating uniformly.

use axum::{
    body::Body,
    extract::{Extension, Path, Query, State},
    http::{header::{CONTENT_DISPOSITION, CONTENT_TYPE}, StatusCode},
    response::Response,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::FilesError,
    middleware::FilesUser,
    models::file::ListFilesQuery,
    services::{files as files_svc, folders as folders_svc},
    state::AppState,
};

/// Literal storage name denoting the requesting user's own Drive root.
const LOCAL_STORAGE: &str = "Drive";

#[derive(Deserialize)]
pub struct ResolveQuery {
    /// Canonical path: `[<storage>]/<rel>`.
    pub path: String,
}

/// Routed target parsed from a canonical path.
enum Target {
    Local { rel: String },
    Remote { mount: String, rel: String },
}

/// Parse `[<storage>]/<rel>` → routed target (`rel` has no leading slash).
fn parse_canonical(path: &str) -> Result<Target, FilesError> {
    let (storage, after) = path
        .trim()
        .strip_prefix('[')
        .and_then(|r| r.split_once(']'))
        .ok_or_else(|| FilesError::Validation("Chemin canonique attendu : [stockage]/chemin".into()))?;
    let rel = after.trim_start_matches('/').to_string();
    if storage == LOCAL_STORAGE {
        Ok(Target::Local { rel })
    } else {
        Ok(Target::Remote { mount: storage.to_string(), rel })
    }
}

fn err(e: impl std::fmt::Display) -> FilesError {
    FilesError::Internal(anyhow::anyhow!(e.to_string()))
}

/// Encode each path segment (UTF-8 bytes → %XX), preserving `/`.
fn enc_path(p: &str) -> String {
    fn enc_seg(seg: &str) -> String {
        seg.bytes().map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        }).collect()
    }
    p.trim_start_matches('/').split('/').filter(|s| !s.is_empty()).map(enc_seg).collect::<Vec<_>>().join("/")
}

/// Resolve a mount NAME to its id for the given user (via the core internal API).
async fn mount_id_by_name(state: &AppState, user_id: Uuid, name: &str) -> Result<Uuid, FilesError> {
    let url = format!(
        "{}/internal/storage/mounts/{}",
        state.settings.core.url.trim_end_matches('/'), user_id
    );
    let resp = reqwest::Client::new()
        .get(&url)
        .header("X-Internal-Secret", &state.settings.core.internal_secret)
        .send().await.map_err(err)?;
    if !resp.status().is_success() {
        return Err(err(format!("liste des montages : HTTP {}", resp.status())));
    }
    let body: Value = resp.json().await.map_err(err)?;
    body.get("connections").and_then(|c| c.as_array())
        .and_then(|arr| arr.iter().find(|m|
            m.get("name").and_then(|v| v.as_str()) == Some(name)
            || m.get("mount_name").and_then(|v| v.as_str()) == Some(name)))
        .and_then(|m| m.get("id").and_then(|v| v.as_str()))
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| FilesError::NotFound(format!("Stockage « {name} » introuvable")))
}

// ── Browse ───────────────────────────────────────────────────────────────────

/// `GET /api/v1/drive/resolve/browse?path=[storage]/dir` — list a directory.
/// Returns `{ items: [{ name, path, is_dir, size_bytes, mime_type, modified_at }] }`
/// where each `path` is the canonical path of the child.
pub async fn browse(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Query(q): Query<ResolveQuery>,
) -> Result<Json<Value>, FilesError> {
    match parse_canonical(&q.path)? {
        Target::Local { rel } => browse_local(&state, user.id, &rel).await,
        Target::Remote { mount, rel } => browse_remote(&state, user.id, &mount, &rel).await,
    }
}

async fn browse_local(state: &AppState, user_id: Uuid, rel: &str) -> Result<Json<Value>, FilesError> {
    // rel = directory path relative to the Drive root (folders store "/A/B").
    let folder_id = if rel.is_empty() {
        None
    } else {
        let folder_path = format!("/{}", rel.trim_matches('/'));
        Some(
            sqlx::query_scalar::<_, Uuid>(
                "SELECT id FROM drive.folders WHERE owner_id = $1 AND path = $2 AND is_trashed = FALSE",
            )
            .bind(user_id)
            .bind(&folder_path)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| FilesError::NotFound(format!("Dossier {folder_path}")))?,
        )
    };

    let base = if rel.is_empty() { String::new() } else { format!("{}/", rel.trim_matches('/')) };
    let mut items: Vec<Value> = Vec::new();

    for f in folders_svc::list_folders(&state.db, user_id, folder_id, false).await? {
        items.push(json!({
            "name":        f.name,
            "path":        format!("[{LOCAL_STORAGE}]/{base}{}", f.name),
            "is_dir":      true,
            "size_bytes":  Value::Null,
            "mime_type":   Value::Null,
            "modified_at": f.updated_at,
        }));
    }

    let files = files_svc::list_files(&state.db, user_id, ListFilesQuery {
        folder_id,
        folder_path_prefix: None,
        mime_type: None,
        starred: None,
        trashed: Some(false),
        recent: None,
        search: None,
        sort_by: Some("name".into()),
        limit: Some(1000),
        offset: Some(0),
    }).await?;
    for f in files {
        items.push(json!({
            "name":        f.name,
            "path":        format!("[{LOCAL_STORAGE}]/{base}{}", f.name),
            "is_dir":      false,
            "size_bytes":  f.size_bytes,
            "mime_type":   f.mime_type,
            "modified_at": f.updated_at,
        }));
    }

    Ok(Json(json!({ "items": items })))
}

async fn browse_remote(state: &AppState, user_id: Uuid, mount: &str, rel: &str) -> Result<Json<Value>, FilesError> {
    let id = mount_id_by_name(state, user_id, mount).await?;
    let path = if rel.is_empty() {
        format!("/internal/storage/mounts/{user_id}/{id}/browse")
    } else {
        format!("/internal/storage/mounts/{user_id}/{id}/browse/{}", enc_path(rel))
    };
    let url = format!("{}{}", state.settings.core.url.trim_end_matches('/'), path);
    let resp = reqwest::Client::new()
        .get(&url)
        .header("X-Internal-Secret", &state.settings.core.internal_secret)
        .send().await.map_err(err)?;
    if !resp.status().is_success() {
        return Err(err(format!("navigation distante : HTTP {}", resp.status())));
    }
    let body: Value = resp.json().await.map_err(err)?;
    // Re-prefix each child path to the canonical "[<mount>]/<path>" form.
    let items: Vec<Value> = body.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default()
        .into_iter().map(|mut it| {
            if let Some(p) = it.get("path").and_then(|v| v.as_str()) {
                let canon = format!("[{mount}]/{}", p.trim_start_matches('/'));
                it["path"] = json!(canon);
            }
            it
        }).collect();
    Ok(Json(json!({ "items": items })))
}

// ── File ─────────────────────────────────────────────────────────────────────

/// `GET /api/v1/drive/resolve/file?path=[storage]/file.ext` — stream a file.
pub async fn file(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Query(q): Query<ResolveQuery>,
) -> Result<Response, FilesError> {
    match parse_canonical(&q.path)? {
        Target::Local { rel } => file_local(&state, user.id, &rel).await,
        Target::Remote { mount, rel } => file_remote(&state, user.id, &mount, &rel).await,
    }
}

async fn file_local(state: &AppState, user_id: Uuid, rel: &str) -> Result<Response, FilesError> {
    if rel.is_empty() {
        return Err(FilesError::Validation("Chemin de fichier vide".into()));
    }
    let (dir, name) = match rel.rsplit_once('/') {
        Some((d, n)) => (d.to_string(), n.to_string()),
        None => (String::new(), rel.to_string()),
    };
    let folder_id = if dir.is_empty() {
        None
    } else {
        let folder_path = format!("/{}", dir.trim_matches('/'));
        Some(
            sqlx::query_scalar::<_, Uuid>(
                "SELECT id FROM drive.folders WHERE owner_id = $1 AND path = $2 AND is_trashed = FALSE",
            )
            .bind(user_id)
            .bind(&folder_path)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| FilesError::NotFound(format!("Dossier {folder_path}")))?,
        )
    };

    let file = sqlx::query_as::<_, crate::models::file::File>(
        "SELECT * FROM drive.files \
         WHERE owner_id = $1 AND name = $2 AND is_trashed = FALSE \
           AND folder_id IS NOT DISTINCT FROM $3",
    )
    .bind(user_id)
    .bind(&name)
    .bind(folder_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| FilesError::NotFound(format!("Fichier {rel}")))?;

    let data = state.storage.get(&file.storage_path).await?;
    let disposition = format!("inline; filename=\"{}\"", file.name.replace('"', "\\\""));
    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, &file.mime_type)
        .header(CONTENT_DISPOSITION, disposition)
        .body(Body::from(data))
        .map_err(err)
}

async fn file_remote(state: &AppState, user_id: Uuid, mount: &str, rel: &str) -> Result<Response, FilesError> {
    if rel.is_empty() {
        return Err(FilesError::Validation("Chemin de fichier vide".into()));
    }
    let id = mount_id_by_name(state, user_id, mount).await?;
    let url = format!(
        "{}/internal/storage/mounts/{}/{}/file/{}",
        state.settings.core.url.trim_end_matches('/'), user_id, id, enc_path(rel)
    );
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

// ── Internal (session-less) variants for module-to-module / background jobs ──────
// Same routing, but the user id comes from the path and the call is gated by the
// IPC secret instead of a user session. Consumed by other modules via FilesClient.

/// `GET /ipc/resolve/:uid/browse?path=[storage]/dir`
pub async fn ipc_browse(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
    Query(q): Query<ResolveQuery>,
) -> Result<Json<Value>, FilesError> {
    match parse_canonical(&q.path)? {
        Target::Local { rel } => browse_local(&state, user_id, &rel).await,
        Target::Remote { mount, rel } => browse_remote(&state, user_id, &mount, &rel).await,
    }
}

/// `GET /ipc/resolve/:uid/file?path=[storage]/file.ext`
pub async fn ipc_file(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
    Query(q): Query<ResolveQuery>,
) -> Result<Response, FilesError> {
    match parse_canonical(&q.path)? {
        Target::Local { rel } => file_local(&state, user_id, &rel).await,
        Target::Remote { mount, rel } => file_remote(&state, user_id, &mount, &rel).await,
    }
}
