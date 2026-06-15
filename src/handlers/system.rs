//! Répertoire SYSTÈME : espace partagé géré par les admins, lisible par TOUS.
//! Réutilise les services drive avec le propriétaire réservé `SYSTEM_OWNER`.
//! Lecture (list/get/download) = tout utilisateur authentifié ; écriture
//! (create/upload/delete) = administrateurs uniquement.
use axum::{
    body::Body,
    extract::{Multipart, Path, Query, State},
    http::{header, StatusCode},
    response::Response,
    Extension, Json,
};
use bytes::Bytes;
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    middleware::FilesUser,
    models::{CreateFolderDto, ListFilesQuery},
    services::{files, folders},
    state::AppState,
};

/// Propriétaire « système » réservé (jamais un vrai utilisateur).
pub const SYSTEM_OWNER: Uuid = Uuid::from_u128(1);

fn require_admin(user: &FilesUser) -> Result<()> {
    if user.role == "admin" { Ok(()) } else { Err(FilesError::Forbidden) }
}

// ── Lecture : tout utilisateur authentifié ──────────────────────────────────────
pub async fn list_folders(State(s): State<AppState>, Query(p): Query<HashMap<String, String>>) -> Result<Json<Value>> {
    let parent = p.get("parent_id").and_then(|v| Uuid::parse_str(v).ok());
    let items = folders::list_folders(&s.db, SYSTEM_OWNER, parent, false).await?;
    Ok(Json(json!({ "folders": items })))
}

pub async fn list_files(State(s): State<AppState>, Query(q): Query<ListFilesQuery>) -> Result<Json<Value>> {
    let items = files::list_files(&s.db, SYSTEM_OWNER, q).await?;
    Ok(Json(json!({ "files": items })))
}

pub async fn get_folder(State(s): State<AppState>, Path(id): Path<Uuid>) -> Result<Json<Value>> {
    let folder = folders::get_folder(&s.db, SYSTEM_OWNER, id).await?;
    let ancestors = folders::get_folder_ancestors(&s.db, SYSTEM_OWNER, id).await?;
    Ok(Json(json!({ "folder": folder, "ancestors": ancestors })))
}

pub async fn download(State(s): State<AppState>, Path(id): Path<Uuid>) -> Result<Response> {
    let file = files::get_file(&s.db, SYSTEM_OWNER, id).await?;
    let data = s.storage.get(&file.storage_path).await?;
    let disp = format!("inline; filename=\"{}\"", file.name.replace('"', "\\\""));
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, &file.mime_type)
        .header(header::CONTENT_DISPOSITION, disp)
        .header(header::CONTENT_LENGTH, data.len())
        .body(Body::from(data))
        .expect("valid response"))
}

// ── Écriture : administrateurs uniquement ───────────────────────────────────────
pub async fn create_folder(State(s): State<AppState>, Extension(user): Extension<FilesUser>, Json(dto): Json<CreateFolderDto>) -> Result<Json<Value>> {
    require_admin(&user)?;
    let folder = folders::create_folder(&s.db, &s.storage, SYSTEM_OWNER, dto).await?;
    Ok(Json(json!({ "folder": folder })))
}

pub async fn upload(State(s): State<AppState>, Extension(user): Extension<FilesUser>, mut multipart: Multipart) -> Result<Json<Value>> {
    require_admin(&user)?;
    let max = s.settings.files.max_upload_bytes;
    let (mut folder_id, mut filename, mut data, mut overwrite) = (None::<Uuid>, None::<String>, None::<Bytes>, false);
    while let Some(field) = multipart.next_field().await.map_err(|e| FilesError::Validation(e.to_string()))? {
        match field.name() {
            Some("folder_id") => { folder_id = Uuid::parse_str(field.text().await.map_err(|e| FilesError::Validation(e.to_string()))?.trim()).ok(); }
            Some("overwrite") => { overwrite = matches!(field.text().await.map_err(|e| FilesError::Validation(e.to_string()))?.trim(), "1" | "true"); }
            Some("file") => {
                let name = field.file_name().unwrap_or("file").to_string();
                let bytes = field.bytes().await.map_err(|e| FilesError::Validation(e.to_string()))?;
                filename = Some(name); data = Some(bytes);
            }
            _ => {}
        }
    }
    let name = filename.ok_or_else(|| FilesError::Validation("Champ 'file' manquant".into()))?;
    let bytes = data.ok_or_else(|| FilesError::Validation("Données manquantes".into()))?;
    let file = files::upload_simple(&s.db, &s.storage, SYSTEM_OWNER, folder_id, &name, bytes, max, overwrite).await?;
    Ok(Json(json!({ "file": file })))
}

pub async fn delete_folder(State(s): State<AppState>, Extension(user): Extension<FilesUser>, Path(id): Path<Uuid>) -> Result<Json<Value>> {
    require_admin(&user)?;
    folders::delete_folder(&s.db, &s.storage, SYSTEM_OWNER, id).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn delete_file(State(s): State<AppState>, Extension(user): Extension<FilesUser>, Path(id): Path<Uuid>) -> Result<Json<Value>> {
    require_admin(&user)?;
    files::delete_file_permanently(&s.db, &s.storage, SYSTEM_OWNER, id).await?;
    Ok(Json(json!({ "ok": true })))
}
