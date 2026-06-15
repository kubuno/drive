use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, Method, StatusCode},
    response::{IntoResponse, Response},
    Extension, Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use bytes::Bytes;
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{errors::Result, middleware::FilesUser, models, services, state::AppState};

// ── Token management API (JWT-authed regular endpoints) ───────────────────────

pub async fn get_webdav_token(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
) -> Result<Json<Value>> {
    let token = ensure_webdav_token(&state.db, user.id).await?;
    Ok(Json(json!({ "token": token })))
}

pub async fn regenerate_webdav_token(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
) -> Result<Json<Value>> {
    let token = new_webdav_token(&state.db, user.id).await?;
    Ok(Json(json!({ "token": token })))
}

async fn ensure_webdav_token(db: &sqlx::PgPool, user_id: Uuid) -> Result<String> {
    if let Some(t) = sqlx::query_scalar::<_, String>(
        "SELECT token FROM drive.webdav_tokens WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(db)
    .await?
    {
        return Ok(t);
    }
    new_webdav_token(db, user_id).await
}

async fn new_webdav_token(db: &sqlx::PgPool, user_id: Uuid) -> Result<String> {
    use rand::Rng;
    let raw: [u8; 24] = rand::thread_rng().gen();
    let token = BASE64.encode(raw);
    sqlx::query(
        "INSERT INTO drive.webdav_tokens (user_id, token)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, created_at = NOW()",
    )
    .bind(user_id)
    .bind(&token)
    .execute(db)
    .await?;
    Ok(token)
}

// ── WebDAV protocol dispatcher (Basic Auth) ───────────────────────────────────

pub async fn webdav_dispatch(State(state): State<AppState>, req: Request) -> Response {
    let owner_id = match authenticate(&state.db, req.headers()).await {
        Some(id) => id,
        None     => {
            return (
                StatusCode::UNAUTHORIZED,
                [(header::WWW_AUTHENTICATE, r#"Basic realm="Kubuno WebDAV""#)],
                "",
            ).into_response()
        }
    };

    // Update last_used_at asynchronously
    let db2 = state.db.clone();
    tokio::spawn(async move {
        let _ = sqlx::query(
            "UPDATE drive.webdav_tokens SET last_used_at = NOW() WHERE user_id = $1",
        )
        .bind(owner_id)
        .execute(&db2)
        .await;
    });

    let method  = req.method().clone();
    let headers = req.headers().clone();
    let path    = req.uri().path().to_string();

    // Strip /webdav prefix; treat empty as "/"
    let dav_path = {
        let s = path.strip_prefix("/webdav").unwrap_or(&path);
        if s.is_empty() { "/".to_string() } else { s.to_string() }
    };

    match method.as_str() {
        "OPTIONS" => options_response(),

        "PROPFIND" => {
            let depth = headers
                .get("depth")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("1")
                .to_string();
            propfind(&state.db, owner_id, &dav_path, &depth).await
        }

        "GET" | "HEAD" => {
            let head = method == Method::HEAD;
            dav_get(&state, owner_id, &dav_path, head).await
        }

        "PUT" => {
            let max = state.settings.files.max_upload_bytes;
            let mime = headers
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/octet-stream")
                .to_string();
            let body = match axum::body::to_bytes(req.into_body(), usize::MAX).await {
                Ok(b)  => b,
                Err(_) => return StatusCode::BAD_REQUEST.into_response(),
            };
            dav_put(&state, owner_id, &dav_path, body, &mime, max).await
        }

        "DELETE" => dav_delete(&state, owner_id, &dav_path).await,

        "MKCOL" => dav_mkcol(&state, owner_id, &dav_path).await,

        "MOVE" => {
            let dest = headers
                .get("destination")
                .and_then(|v| v.to_str().ok())
                .map(extract_dav_path)
                .unwrap_or_default();
            dav_move(&state, owner_id, &dav_path, &dest).await
        }

        _ => StatusCode::METHOD_NOT_ALLOWED.into_response(),
    }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async fn authenticate(db: &sqlx::PgPool, headers: &axum::http::HeaderMap) -> Option<Uuid> {
    let auth    = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let b64     = auth.strip_prefix("Basic ")?;
    let decoded = BASE64.decode(b64).ok()?;
    let creds   = String::from_utf8(decoded).ok()?;
    let (email, token) = creds.split_once(':')?;

    sqlx::query_scalar::<_, Uuid>(
        r#"SELECT wt.user_id
           FROM drive.webdav_tokens wt
           JOIN core.users u ON u.id = wt.user_id
           WHERE u.email = $1 AND wt.token = $2 AND u.is_active = TRUE"#,
    )
    .bind(email)
    .bind(token)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
}

// ── Path helpers ──────────────────────────────────────────────────────────────

fn extract_dav_path(destination: &str) -> String {
    if let Some(idx) = destination.find("/webdav") {
        let rest = &destination[idx + 7..];
        if rest.is_empty() { "/".to_string() } else { rest.to_string() }
    } else {
        "/".to_string()
    }
}

fn norm(p: &str) -> &str {
    let s = p.trim_end_matches('/');
    if s.is_empty() { "/" } else { s }
}

fn split_path(p: &str) -> (String, String) {
    let s = norm(p);
    if let Some(i) = s.rfind('/') {
        let parent = if i == 0 { "/" } else { &s[..i] };
        (parent.to_string(), s[i + 1..].to_string())
    } else {
        ("/".to_string(), s.to_string())
    }
}

// ── Resource resolution ───────────────────────────────────────────────────────

#[derive(Clone)]
struct FolderRow { id: Uuid, name: String, dt: DateTime<Utc> }
#[derive(Clone)]
struct FileRow   { id: Uuid, name: String, size: i64, mime: String, path: String, dt: DateTime<Utc> }

async fn resolve_folder(db: &sqlx::PgPool, owner: Uuid, dav_path: &str) -> Option<FolderRow> {
    let s = norm(dav_path);
    if s == "/" { return None; }
    sqlx::query_as::<_, (Uuid, String, DateTime<Utc>)>(
        "SELECT id, name, updated_at FROM drive.folders WHERE owner_id = $1 AND path = $2",
    )
    .bind(owner).bind(s)
    .fetch_optional(db).await.ok().flatten()
    .map(|(id, name, dt)| FolderRow { id, name, dt })
}

async fn resolve_file(db: &sqlx::PgPool, owner: Uuid, dav_path: &str) -> Option<FileRow> {
    let s = norm(dav_path);
    if s == "/" { return None; }
    let (parent, name) = split_path(s);

    let folder_id: Option<Uuid> = if parent == "/" {
        None
    } else {
        sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM drive.folders WHERE owner_id = $1 AND path = $2",
        )
        .bind(owner).bind(&parent)
        .fetch_optional(db).await.ok().flatten()
        .map(Some)?
    };

    let row = if let Some(fid) = folder_id {
        sqlx::query_as::<_, (Uuid, String, i64, String, String, DateTime<Utc>)>(
            "SELECT id, name, size_bytes, mime_type, storage_path, updated_at
             FROM drive.files
             WHERE owner_id = $1 AND folder_id = $2 AND name = $3 AND is_trashed = FALSE",
        )
        .bind(owner).bind(fid).bind(&name)
        .fetch_optional(db).await.ok().flatten()
    } else {
        sqlx::query_as::<_, (Uuid, String, i64, String, String, DateTime<Utc>)>(
            "SELECT id, name, size_bytes, mime_type, storage_path, updated_at
             FROM drive.files
             WHERE owner_id = $1 AND folder_id IS NULL AND name = $2 AND is_trashed = FALSE",
        )
        .bind(owner).bind(&name)
        .fetch_optional(db).await.ok().flatten()
    };

    row.map(|(id, name, size, mime, path, dt)| FileRow { id, name, size, mime, path, dt })
}

// ── OPTIONS ───────────────────────────────────────────────────────────────────

fn options_response() -> Response {
    (
        StatusCode::OK,
        [
            ("DAV",           "1, 2"),
            ("Allow",         "OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, MOVE"),
            ("MS-Author-Via", "DAV"),
        ],
        "",
    ).into_response()
}

// ── PROPFIND ──────────────────────────────────────────────────────────────────

fn rfc1123(dt: DateTime<Utc>) -> String {
    dt.format("%a, %d %b %Y %H:%M:%S GMT").to_string()
}

fn prop_collection(href: &str, name: &str, dt: DateTime<Utc>) -> String {
    format!(
        "  <D:response>\n    <D:href>{href}</D:href>\n    <D:propstat>\n      <D:prop>\n\
         <D:displayname>{name}</D:displayname>\n        <D:resourcetype><D:collection/></D:resourcetype>\n\
         <D:getlastmodified>{}</D:getlastmodified>\n      </D:prop>\n\
         <D:status>HTTP/1.1 200 OK</D:status>\n    </D:propstat>\n  </D:response>\n",
        rfc1123(dt)
    )
}

fn prop_file(href: &str, name: &str, size: i64, mime: &str, dt: DateTime<Utc>) -> String {
    format!(
        "  <D:response>\n    <D:href>{href}</D:href>\n    <D:propstat>\n      <D:prop>\n\
         <D:displayname>{name}</D:displayname>\n        <D:resourcetype/>\n\
         <D:getcontentlength>{size}</D:getcontentlength>\n        <D:getcontenttype>{mime}</D:getcontenttype>\n\
         <D:getlastmodified>{}</D:getlastmodified>\n      </D:prop>\n\
         <D:status>HTTP/1.1 200 OK</D:status>\n    </D:propstat>\n  </D:response>\n",
        rfc1123(dt)
    )
}

fn make_href(dav_path: &str, is_collection: bool) -> String {
    let s = norm(dav_path);
    if s == "/" {
        "/webdav/".to_string()
    } else if is_collection {
        format!("/webdav{s}/")
    } else {
        format!("/webdav{s}")
    }
}

async fn propfind(db: &sqlx::PgPool, owner: Uuid, dav_path: &str, depth: &str) -> Response {
    let s = norm(dav_path);
    let is_root = s == "/";

    if !is_root {
        if let Some(f) = resolve_folder(db, owner, s).await {
            let self_href = make_href(s, true);
            let mut body  = xml_header();
            body.push_str(&prop_collection(&self_href, &f.name, f.dt));
            if depth != "0" {
                body.push_str(&children_xml(db, owner, Some(f.id), s).await);
            }
            body.push_str("</D:multistatus>");
            return xml_207(body);
        }
        if let Some(f) = resolve_file(db, owner, s).await {
            let href = make_href(s, false);
            let body = format!("{}{}</D:multistatus>", xml_header(), prop_file(&href, &f.name, f.size, &f.mime, f.dt));
            return xml_207(body);
        }
        return StatusCode::NOT_FOUND.into_response();
    }

    // Root
    let mut body = xml_header();
    body.push_str(&prop_collection("/webdav/", "Mes fichiers", Utc::now()));
    if depth != "0" {
        body.push_str(&children_xml(db, owner, None, "/").await);
    }
    body.push_str("</D:multistatus>");
    xml_207(body)
}

fn xml_header() -> String {
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<D:multistatus xmlns:D=\"DAV:\">\n".to_string()
}

fn xml_207(body: String) -> Response {
    (StatusCode::MULTI_STATUS, [(header::CONTENT_TYPE, "application/xml; charset=utf-8")], body).into_response()
}

async fn children_xml(db: &sqlx::PgPool, owner: Uuid, folder_id: Option<Uuid>, parent_dav: &str) -> String {
    let parent = norm(parent_dav);
    let mut out = String::new();

    // Sub-folders
    let folders: Vec<(Uuid, String, DateTime<Utc>)> = if let Some(fid) = folder_id {
        sqlx::query_as(
            "SELECT id, name, updated_at FROM drive.folders WHERE owner_id=$1 AND parent_id=$2 ORDER BY name",
        ).bind(owner).bind(fid).fetch_all(db).await.unwrap_or_default()
    } else {
        sqlx::query_as(
            "SELECT id, name, updated_at FROM drive.folders WHERE owner_id=$1 AND parent_id IS NULL ORDER BY name",
        ).bind(owner).fetch_all(db).await.unwrap_or_default()
    };

    for (_, name, dt) in &folders {
        let href = if parent == "/" { format!("/webdav/{name}/") } else { format!("/webdav{parent}/{name}/") };
        out.push_str(&prop_collection(&href, name, *dt));
    }

    // Files
    let files: Vec<(String, i64, String, DateTime<Utc>)> = if let Some(fid) = folder_id {
        sqlx::query_as(
            "SELECT name, size_bytes, mime_type, updated_at FROM drive.files WHERE owner_id=$1 AND folder_id=$2 AND is_trashed=FALSE ORDER BY name",
        ).bind(owner).bind(fid).fetch_all(db).await.unwrap_or_default()
    } else {
        sqlx::query_as(
            "SELECT name, size_bytes, mime_type, updated_at FROM drive.files WHERE owner_id=$1 AND folder_id IS NULL AND is_trashed=FALSE ORDER BY name",
        ).bind(owner).fetch_all(db).await.unwrap_or_default()
    };

    for (name, size, mime, dt) in &files {
        let href = if parent == "/" { format!("/webdav/{name}") } else { format!("/webdav{parent}/{name}") };
        out.push_str(&prop_file(&href, name, *size, &mime, *dt));
    }

    out
}

// ── GET / HEAD ────────────────────────────────────────────────────────────────

async fn dav_get(state: &AppState, owner: Uuid, dav_path: &str, head: bool) -> Response {
    let s = norm(dav_path);
    if s == "/" || resolve_folder(&state.db, owner, s).await.is_some() {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    let file = match resolve_file(&state.db, owner, s).await {
        Some(f) => f,
        None    => return StatusCode::NOT_FOUND.into_response(),
    };
    if head {
        return (StatusCode::OK, [
            (header::CONTENT_TYPE,   file.mime.parse::<axum::http::HeaderValue>().unwrap_or_else(|_| "application/octet-stream".parse().unwrap())),
            (header::CONTENT_LENGTH, file.size.to_string().parse().unwrap()),
        ], "").into_response();
    }
    match state.storage.get(&file.path).await {
        Ok(data) => (StatusCode::OK, [
            (header::CONTENT_TYPE,   file.mime.parse::<axum::http::HeaderValue>().unwrap_or_else(|_| "application/octet-stream".parse().unwrap())),
            (header::CONTENT_LENGTH, file.size.to_string().parse().unwrap()),
        ], Body::from(data)).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

// ── PUT ───────────────────────────────────────────────────────────────────────

async fn dav_put(state: &AppState, owner: Uuid, dav_path: &str, body: Bytes, mime: &str, max: u64) -> Response {
    let s = norm(dav_path);
    let (parent, name) = split_path(s);
    if name.is_empty() { return StatusCode::BAD_REQUEST.into_response(); }

    let folder_id: Option<Uuid> = if parent == "/" {
        None
    } else {
        match sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM drive.folders WHERE owner_id = $1 AND path = $2",
        ).bind(owner).bind(&parent).fetch_optional(&state.db).await {
            Ok(Some(id)) => Some(id),
            _ => return StatusCode::CONFLICT.into_response(),
        }
    };

    match services::files::upload_simple(&state.db, &state.storage, owner, folder_id, &name, body, max, true).await {
        Ok(_)  => StatusCode::CREATED.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

async fn dav_delete(state: &AppState, owner: Uuid, dav_path: &str) -> Response {
    let s = norm(dav_path);
    if s == "/" { return StatusCode::FORBIDDEN.into_response(); }

    if let Some(f) = resolve_folder(&state.db, owner, s).await {
        return match services::folders::delete_folder(&state.db, &state.storage, owner, f.id).await {
            Ok(_)  => StatusCode::NO_CONTENT.into_response(),
            Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        };
    }
    if let Some(f) = resolve_file(&state.db, owner, s).await {
        return match services::files::delete_file_permanently(&state.db, &state.storage, owner, f.id).await {
            Ok(_)  => StatusCode::NO_CONTENT.into_response(),
            Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        };
    }
    StatusCode::NOT_FOUND.into_response()
}

// ── MKCOL ─────────────────────────────────────────────────────────────────────

async fn dav_mkcol(state: &AppState, owner: Uuid, dav_path: &str) -> Response {
    let s = norm(dav_path);
    let (parent, name) = split_path(s);
    if name.is_empty() { return StatusCode::FORBIDDEN.into_response(); }

    let parent_id: Option<Uuid> = if parent == "/" {
        None
    } else {
        match sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM drive.folders WHERE owner_id = $1 AND path = $2",
        ).bind(owner).bind(&parent).fetch_optional(&state.db).await {
            Ok(Some(id)) => Some(id),
            _ => return StatusCode::CONFLICT.into_response(),
        }
    };

    let dto = models::CreateFolderDto { name, parent_id };
    match services::folders::create_folder(&state.db, &state.storage, owner, dto).await {
        Ok(_)  => StatusCode::CREATED.into_response(),
        Err(e) => {
            let s = e.to_string();
            if s.contains("unique") || s.contains("duplicate") || s.contains("already") {
                StatusCode::METHOD_NOT_ALLOWED.into_response()
            } else {
                StatusCode::INTERNAL_SERVER_ERROR.into_response()
            }
        }
    }
}

// ── MOVE ──────────────────────────────────────────────────────────────────────

async fn dav_move(state: &AppState, owner: Uuid, src_path: &str, dst_path: &str) -> Response {
    let src = norm(src_path);
    let dst = norm(dst_path);
    if src == "/" || dst == "/" { return StatusCode::FORBIDDEN.into_response(); }
    let (dst_parent, dst_name) = split_path(dst);

    let dst_folder_id: Option<Uuid> = if dst_parent == "/" {
        None
    } else {
        match sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM drive.folders WHERE owner_id = $1 AND path = $2",
        ).bind(owner).bind(&dst_parent).fetch_optional(&state.db).await {
            Ok(Some(id)) => Some(id),
            _ => return StatusCode::CONFLICT.into_response(),
        }
    };

    if let Some(f) = resolve_folder(&state.db, owner, src).await {
        let (_, src_name) = split_path(src);
        if dst_name != src_name {
            let dto = models::RenameFolderDto { name: dst_name, overwrite: false, strict: false };
            let _ = services::folders::rename_folder(&state.db, &state.storage, owner, f.id, dto).await;
        }
        return match services::folders::move_folder(&state.db, &state.storage, owner, f.id, models::MoveFolderDto { parent_id: dst_folder_id, overwrite: false, strict: false }).await {
            Ok(_)  => StatusCode::CREATED.into_response(),
            Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        };
    }

    if let Some(f) = resolve_file(&state.db, owner, src).await {
        let (_, src_name) = split_path(src);
        if dst_name != src_name {
            let dto = models::RenameFileDto { name: dst_name, overwrite: false, strict: false };
            let _ = services::files::rename_file(&state.db, &state.storage, owner, f.id, dto).await;
        }
        return match services::files::move_file(&state.db, &state.storage, owner, f.id, models::MoveFileDto { folder_id: dst_folder_id, overwrite: false, strict: false }).await {
            Ok(_)  => StatusCode::CREATED.into_response(),
            Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        };
    }

    StatusCode::NOT_FOUND.into_response()
}
