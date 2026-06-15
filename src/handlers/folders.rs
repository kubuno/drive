use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::Result,
    middleware::FilesUser,
    models::{CreateFolderDto, MoveFolderDto, RenameFolderDto, SetFolderColorDto},
    services::{activity, folders},
    state::AppState,
};

pub async fn list(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Value>> {
    let parent_id = params
        .get("parent_id")
        .and_then(|s| Uuid::parse_str(s).ok());
    let trashed = params.get("trashed").map(|s| s == "true").unwrap_or(false);

    let items = folders::list_folders(&state.db, user.id, parent_id, trashed).await?;
    Ok(Json(json!({ "folders": items })))
}

/// GET /folders/by-size — dossiers triés par taille récursive décroissante.
pub async fn list_by_size(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Value>> {
    let limit = params.get("limit").and_then(|s| s.parse::<i64>().ok()).unwrap_or(500);
    let items = folders::list_folders_by_size(&state.db, user.id, limit).await?;
    Ok(Json(json!({ "folders": items })))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Json(dto): Json<CreateFolderDto>,
) -> Result<Json<Value>> {
    let folder = folders::create_folder(&state.db, &state.storage, user.id, dto).await?;
    activity::log_folder(&state.db, folder.id, user.id, &user.email, "created",
        serde_json::json!({})).await;
    Ok(Json(json!({ "folder": folder })))
}

pub async fn get(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(folder_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let folder    = folders::get_folder(&state.db, user.id, folder_id).await?;
    let ancestors = folders::get_folder_ancestors(&state.db, user.id, folder_id).await?;
    Ok(Json(json!({ "folder": folder, "ancestors": ancestors })))
}

pub async fn rename(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(folder_id): Path<Uuid>,
    Json(dto): Json<RenameFolderDto>,
) -> Result<Json<Value>> {
    let old    = folders::get_folder(&state.db, user.id, folder_id).await?;
    let folder = folders::rename_folder(&state.db, &state.storage, user.id, folder_id, dto).await?;
    activity::log_folder(&state.db, folder.id, user.id, &user.email, "renamed",
        serde_json::json!({ "old_name": old.name, "new_name": folder.name })).await;
    Ok(Json(json!({ "folder": folder })))
}

pub async fn move_folder(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(folder_id): Path<Uuid>,
    Json(dto): Json<MoveFolderDto>,
) -> Result<Json<Value>> {
    let folder = folders::move_folder(&state.db, &state.storage, user.id, folder_id, dto).await?;
    activity::log_folder(&state.db, folder.id, user.id, &user.email, "moved",
        serde_json::json!({})).await;
    Ok(Json(json!({ "folder": folder })))
}

pub async fn trash(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(folder_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let folder = folders::trash_folder(&state.db, user.id, folder_id).await?;
    activity::log_folder(&state.db, folder_id, user.id, &user.email, "trashed",
        serde_json::json!({})).await;
    Ok(Json(json!({ "folder": folder })))
}

pub async fn restore(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(folder_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let folder = folders::restore_folder(&state.db, user.id, folder_id).await?;
    activity::log_folder(&state.db, folder_id, user.id, &user.email, "restored",
        serde_json::json!({})).await;
    Ok(Json(json!({ "folder": folder })))
}

pub async fn delete(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(folder_id): Path<Uuid>,
) -> Result<Json<Value>> {
    activity::log_folder(&state.db, folder_id, user.id, &user.email, "deleted",
        serde_json::json!({})).await;
    folders::delete_folder(&state.db, &state.storage, user.id, folder_id).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn star(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(folder_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let folder = folders::toggle_star_folder(&state.db, user.id, folder_id).await?;
    Ok(Json(json!({ "folder": folder })))
}

pub async fn set_color(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(folder_id): Path<Uuid>,
    Json(dto): Json<SetFolderColorDto>,
) -> Result<Json<Value>> {
    let folder = folders::set_folder_color(&state.db, user.id, folder_id, dto).await?;
    Ok(Json(json!({ "folder": folder })))
}

pub async fn purge_trash(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
) -> Result<Json<Value>> {
    let result = folders::purge_trash(&state.db, &state.storage, user.id).await?;
    Ok(Json(json!({
        "folders_deleted": result.folders_deleted,
        "files_deleted":   result.files_deleted,
    })))
}
