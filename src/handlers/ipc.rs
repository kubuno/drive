// Handlers IPC — accès inter-modules à la structure fichiers/dossiers.
// Authentifié par X-Internal-Secret uniquement (pas de JWT utilisateur).

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use base64::Engine as _;
use bytes::Bytes;
use kubuno_storage::path as storage_path;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    models::{CreateFolderDto, MoveFileDto, RenameFileDto},
    services::{files, folders},
    state::AppState,
};

// ── Dossiers ─────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct IpcCreateFolderDto {
    pub user_id:   Uuid,
    pub name:      String,
    pub parent_id: Option<Uuid>,
}

pub async fn create_folder(
    State(state): State<AppState>,
    Json(dto): Json<IpcCreateFolderDto>,
) -> Result<(StatusCode, Json<Value>)> {
    let folder = folders::create_folder(
        &state.db,
        &state.storage,
        dto.user_id,
        CreateFolderDto { name: dto.name, parent_id: dto.parent_id },
    )
    .await?;

    // Chemin physique absolu — utile pour les modules qui écrivent directement sur disque
    let rel = storage_path::user_folder_dir(dto.user_id, &folder.path);
    let disk_path = std::path::PathBuf::from(state.settings.storage.local_path()).join(&rel);

    Ok((StatusCode::CREATED, Json(json!({
        "folder":    folder,
        "disk_path": disk_path.to_string_lossy(),
    }))))
}

pub async fn get_folder(
    State(state): State<AppState>,
    Path((user_id, folder_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let folder = folders::get_folder(&state.db, user_id, folder_id).await?;
    Ok(Json(json!({ "folder": folder })))
}

pub async fn delete_folder(
    State(state): State<AppState>,
    Path((user_id, folder_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode> {
    folders::delete_folder(&state.db, &state.storage, user_id, folder_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct IpcEnsureFolderPathDto {
    pub user_id: Uuid,
    pub path:    String,
    /// Si true, tous les dossiers du chemin sont marqués is_protected = TRUE (ne peuvent pas être supprimés/renommés).
    #[serde(default)]
    pub protect: bool,
    /// Si true, les segments dont le nom commence par '.' sont marqués is_hidden = TRUE
    /// (exclus du navigateur). Ex. "Office/.media" → ".media" caché, "Office" visible.
    #[serde(default)]
    pub hidden:  bool,
    /// Icône (nom Lucide) appliquée au dossier feuille — dossier de module/sous-module.
    #[serde(default)]
    pub icon:    Option<String>,
}

/// Crée toute la hiérarchie de dossiers (idempotent).
/// POST /ipc/folders/ensure-path { user_id, path: "Office/Documents", protect: true, icon: "FileText" }
pub async fn ensure_folder_path(
    State(state): State<AppState>,
    Json(dto): Json<IpcEnsureFolderPathDto>,
) -> Result<Json<Value>> {
    let folder = folders::ensure_path(&state.db, &state.storage, dto.user_id, &dto.path, dto.protect, dto.hidden, dto.icon.as_deref()).await?;
    let rel       = storage_path::user_folder_dir(dto.user_id, &folder.path);
    let disk_path = std::path::PathBuf::from(state.settings.storage.local_path()).join(&rel);
    Ok(Json(json!({
        "folder":    folder,
        "disk_path": disk_path.to_string_lossy(),
    })))
}

// ── Fichiers ──────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct IpcCreateFileDto {
    pub user_id:      Uuid,
    pub folder_id:    Option<Uuid>,
    pub name:         String,
    pub mime_type:    String,
    pub size_bytes:   i64,
    pub storage_path: String,
    pub content_hash: Option<String>,
    #[serde(default)]
    pub overwrite:    bool,
}

pub async fn create_file(
    State(state): State<AppState>,
    Json(dto): Json<IpcCreateFileDto>,
) -> Result<(StatusCode, Json<Value>)> {
    let safe_name = files::resolve_name(&state.db, &state.storage, dto.user_id, dto.folder_id, &dto.name, dto.overwrite, false).await?;

    let file = files::create_file_record(
        &state.db,
        dto.user_id,
        dto.folder_id,
        &safe_name,
        &dto.mime_type,
        dto.size_bytes,
        &dto.storage_path,
        dto.content_hash.as_deref(),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(json!({ "file": file }))))
}

pub async fn get_file(
    State(state): State<AppState>,
    Path((user_id, file_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let file = files::get_file(&state.db, user_id, file_id).await?;
    Ok(Json(json!({ "file": file })))
}

/// GET /ipc/files/:uid/:id/content — retourne le contenu du fichier en base64.
/// Permet aux modules d'importer ou de traiter le contenu d'un fichier Files.
pub async fn get_file_content(
    State(state): State<AppState>,
    Path((user_id, file_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let file = files::get_file(&state.db, user_id, file_id).await?;
    let data = state.storage.get(&file.storage_path).await
        .map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;
    let content_b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    Ok(Json(json!({
        "file":     file,
        "content":  content_b64,
    })))
}

#[derive(Deserialize)]
pub struct IpcListQuery {
    pub user_id:   Uuid,
    pub folder_id: Option<Uuid>,
}

pub async fn list_files(
    State(state): State<AppState>,
    Query(q): Query<IpcListQuery>,
) -> Result<Json<Value>> {
    let items = files::list_files(
        &state.db,
        q.user_id,
        crate::models::ListFilesQuery {
            folder_id: q.folder_id,
            ..Default::default()
        },
    )
    .await?;
    Ok(Json(json!({ "files": items })))
}

#[derive(Deserialize)]
pub struct IpcMoveFileDto {
    pub user_id:   Uuid,
    pub folder_id: Option<Uuid>,
    #[serde(default)]
    pub overwrite: bool,
}

pub async fn move_file(
    State(state): State<AppState>,
    Path(file_id): Path<Uuid>,
    Json(dto): Json<IpcMoveFileDto>,
) -> Result<Json<Value>> {
    let file = files::move_file(
        &state.db,
        &state.storage,
        dto.user_id,
        file_id,
        MoveFileDto { folder_id: dto.folder_id, overwrite: dto.overwrite, strict: false },
    )
    .await?;
    Ok(Json(json!({ "file": file })))
}

#[derive(Deserialize)]
pub struct IpcFileNamesDto {
    pub user_id: Uuid,
    pub ids:     Vec<Uuid>,
}

/// Noms de plusieurs fichiers (pour que les apps affichent le titre = nom du fichier
/// dans leurs listes) → JSON { "<file_id>": "<name>" }.
pub async fn file_names(
    State(state): State<AppState>,
    Json(dto): Json<IpcFileNamesDto>,
) -> Result<Json<Value>> {
    let map = files::file_names(&state.db, dto.user_id, &dto.ids).await?;
    Ok(Json(serde_json::to_value(map).unwrap_or_else(|_| json!({}))))
}

#[derive(Deserialize)]
pub struct IpcRenameFileDto {
    pub user_id: Uuid,
    pub name:    String,
}

pub async fn rename_file(
    State(state): State<AppState>,
    Path(file_id): Path<Uuid>,
    Json(dto): Json<IpcRenameFileDto>,
) -> Result<Json<Value>> {
    let file = files::rename_file(
        &state.db,
        &state.storage,
        dto.user_id,
        file_id,
        RenameFileDto { name: dto.name, overwrite: false, strict: false },
    )
    .await?;
    Ok(Json(json!({ "file": file })))
}

#[derive(Deserialize)]
pub struct IpcDeleteFileDto {
    pub user_id: Uuid,
}

pub async fn delete_file(
    State(state): State<AppState>,
    Path(file_id): Path<Uuid>,
    Json(dto): Json<IpcDeleteFileDto>,
) -> Result<StatusCode> {
    files::delete_file_permanently(&state.db, &state.storage, dto.user_id, file_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct IpcCreateFileWithContentDto {
    pub user_id:   Uuid,
    pub folder_id: Option<Uuid>,
    pub name:      String,
    pub mime_type: String,
    /// Contenu du fichier encodé en base64.
    pub content:   String,
    pub metadata:  Option<serde_json::Value>,
    #[serde(default)]
    pub overwrite: bool,
}

/// Crée un fichier avec son contenu en une seule opération.
/// POST /ipc/files/with-content { user_id, folder_id?, name, mime_type, content (base64) }
pub async fn create_file_with_content(
    State(state): State<AppState>,
    Json(dto): Json<IpcCreateFileWithContentDto>,
) -> Result<(StatusCode, Json<Value>)> {
    let raw = base64::engine::general_purpose::STANDARD
        .decode(&dto.content)
        .map_err(|e| FilesError::Validation(format!("Contenu base64 invalide: {e}")))?;
    let data = Bytes::from(raw);

    let file = files::create_with_bytes(
        &state.db, &state.storage,
        dto.user_id, dto.folder_id,
        &dto.name, &dto.mime_type,
        data, dto.metadata, dto.overwrite,
    ).await?;

    Ok((StatusCode::CREATED, Json(json!({ "file": file }))))
}

#[derive(Deserialize)]
pub struct IpcUpdateFileContentDto {
    pub user_id: Uuid,
    /// Nouveau contenu encodé en base64.
    pub content: String,
}

/// Remplace le contenu d'un fichier existant.
/// PUT /ipc/files/:id/content { user_id, content (base64) }
pub async fn update_file_content(
    State(state): State<AppState>,
    Path(file_id): Path<Uuid>,
    Json(dto): Json<IpcUpdateFileContentDto>,
) -> Result<Json<Value>> {
    let raw = base64::engine::general_purpose::STANDARD
        .decode(&dto.content)
        .map_err(|e| FilesError::Validation(format!("Contenu base64 invalide: {e}")))?;
    let data = Bytes::from(raw);

    let file = files::update_content_bytes(
        &state.db, &state.storage,
        dto.user_id, file_id, data,
    ).await?;

    Ok(Json(json!({ "file": file })))
}

#[derive(Deserialize)]
pub struct IpcSetProtectedDto {
    pub user_id:   Uuid,
    pub protected: bool,
}

/// Protège/déprotège un FICHIER (les apps protègent leurs fichiers, ex. Flow
/// protège un .kbflw tant que son exécution se poursuit).
/// PATCH /ipc/files/:id/protect { user_id, protected }
pub async fn set_file_protected(
    State(state): State<AppState>,
    Path(file_id): Path<Uuid>,
    Json(dto): Json<IpcSetProtectedDto>,
) -> Result<Json<Value>> {
    let file = files::set_protected(&state.db, dto.user_id, file_id, dto.protected).await?;
    Ok(Json(json!({ "file": file })))
}

/// Protège/déprotège un DOSSIER.
/// PATCH /ipc/folders/:id/protect { user_id, protected }
pub async fn set_folder_protected(
    State(state): State<AppState>,
    Path(folder_id): Path<Uuid>,
    Json(dto): Json<IpcSetProtectedDto>,
) -> Result<Json<Value>> {
    let folder = folders::set_protected(&state.db, dto.user_id, folder_id, dto.protected).await?;
    Ok(Json(json!({ "folder": folder })))
}
