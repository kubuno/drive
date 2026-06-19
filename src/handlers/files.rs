use axum::{
    body::Body,
    extract::{Multipart, Path, Query, State},
    http::{header, StatusCode},
    response::Response,
    Extension, Json,
};
use bytes::Bytes;
use serde_json::{json, Value};
use uuid::Uuid;

use serde::Deserialize;

use crate::{
    errors::{FilesError, Result},
    middleware::FilesUser,
    models::{ListFilesQuery, MoveFileDto, RenameFileDto},
    services::{access, activity, files, locks, thumbnails},
    state::AppState,
};

#[derive(Deserialize)]
pub struct CopyFileDto {
    pub folder_id: Option<uuid::Uuid>,
}

#[derive(Deserialize)]
pub struct SetOpenWithDto {
    pub module_id: Option<String>,
}

#[derive(Deserialize)]
pub struct UserMetadataDto {
    pub title:       Option<String>,
    pub description: Option<String>,
    pub author:      Option<String>,
    pub keywords:    Option<Vec<String>>,
}

#[derive(Deserialize)]
pub struct CompressDto {
    pub file_ids:   Vec<uuid::Uuid>,
    pub folder_ids: Vec<uuid::Uuid>,
    pub archive_name: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Query(query): Query<ListFilesQuery>,
) -> Result<Json<Value>> {
    let items = files::list_files(&state.db, user.id, query).await?;
    Ok(Json(json!({ "files": items })))
}

/// Upload simple (multipart/form-data, un seul fichier)
pub async fn upload(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    mut multipart: Multipart,
) -> Result<Json<Value>> {
    let max = state.settings.files.max_upload_bytes;
    let mut folder_id: Option<Uuid> = None;
    let mut filename: Option<String> = None;
    let mut data: Option<Bytes> = None;
    let mut overwrite = false;

    while let Some(field) = multipart.next_field().await
        .map_err(|e| FilesError::Validation(e.to_string()))?
    {
        match field.name() {
            Some("folder_id") => {
                let v = field.text().await.map_err(|e| FilesError::Validation(e.to_string()))?;
                folder_id = Uuid::parse_str(&v).ok();
            }
            Some("overwrite") => {
                let v = field.text().await.map_err(|e| FilesError::Validation(e.to_string()))?;
                overwrite = matches!(v.trim(), "1" | "true");
            }
            Some("file") => {
                let name = field.file_name().unwrap_or("file").to_string();
                let bytes = field.bytes().await
                    .map_err(|e| FilesError::Validation(e.to_string()))?;
                filename = Some(name);
                data = Some(bytes);
            }
            _ => {}
        }
    }

    let name = filename.ok_or_else(|| FilesError::Validation("Champ 'file' manquant".into()))?;
    let bytes = data.ok_or_else(|| FilesError::Validation("Données manquantes".into()))?;

    let file = files::upload_simple(
        &state.db,
        &state.storage,
        user.id,
        folder_id,
        &name,
        bytes.clone(),
        max,
        overwrite,
    ).await?;

    activity::log_file(&state.db, file.id, user.id, &user.email, "uploaded",
        serde_json::json!({ "size": file.size_bytes })).await;

    crate::events::notify_change(&state.settings, user.id);

    // Génération thumbnail en arrière-plan
    let db2       = state.db.clone();
    let storage2  = state.storage.clone();
    let thumb_size = state.settings.files.thumbnail_size;
    let file_id   = file.id;
    let owner_id  = file.owner_id;
    let storage_path = file.storage_path.clone();
    let mime      = file.mime_type.clone();
    tokio::spawn(async move {
        let _ = thumbnails::generate_thumbnail(
            &db2, &storage2, owner_id, file_id, &storage_path, &mime, thumb_size
        ).await;
    });

    Ok(Json(json!({ "file": file })))
}

pub async fn get(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let file = files::get_file(&state.db, user.id, file_id).await?;
    Ok(Json(json!({ "file": file })))
}

/// Remplace le contenu d'un fichier image (PUT /files/:id/content)
/// Utilisé par l'éditeur Paint pour sauvegarder les modifications.
pub async fn replace_content(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<Json<Value>> {
    let file = files::get_file(&state.db, user.id, file_id).await?;

    if !file.mime_type.starts_with("image/") {
        return Err(FilesError::Validation("Ce fichier n'est pas une image".into()));
    }

    let mut new_data: Option<Bytes> = None;
    while let Some(field) = multipart.next_field().await
        .map_err(|e| FilesError::Validation(e.to_string()))?
    {
        if field.name() == Some("file") {
            new_data = Some(field.bytes().await
                .map_err(|e| FilesError::Validation(e.to_string()))?);
        }
    }

    let bytes = new_data.ok_or_else(|| FilesError::Validation("Champ 'file' manquant".into()))?;
    let new_size = bytes.len() as i64;
    let size_delta = new_size - file.size_bytes;

    // Remplace dans le stockage
    state.storage.put(&file.storage_path, bytes).await?;

    // Met à jour la taille en DB et invalide le thumbnail
    sqlx::query!(
        "UPDATE drive.files SET size_bytes = $1, has_thumbnail = FALSE, updated_at = NOW() WHERE id = $2",
        new_size, file_id
    ).execute(&state.db).await?;

    // Ajuste le quota
    files::update_used_bytes(&state.db, user.id, size_delta).await;

    // Regénère le thumbnail en arrière-plan
    let db2      = state.db.clone();
    let storage2 = state.storage.clone();
    let thumb_sz = state.settings.files.thumbnail_size;
    let sp       = file.storage_path.clone();
    let mime     = file.mime_type.clone();
    tokio::spawn(async move {
        let _ = thumbnails::generate_thumbnail(&db2, &storage2, user.id, file_id, &sp, &mime, thumb_sz).await;
    });

    activity::log_file(&state.db, file_id, user.id, &user.email, "edited_paint",
        serde_json::json!({ "size": new_size })).await;

    Ok(Json(serde_json::json!({ "ok": true, "size_bytes": new_size })))
}

/// Téléchargement du fichier
pub async fn download(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
    headers: axum::http::HeaderMap,
) -> Result<Response> {
    // Readable = owned OR internally shared with the user (« Partagés avec moi »).
    let file = files::get_file_readable(&state.db, user.id, file_id).await?;
    let data = state.storage.get(&file.storage_path).await?;

    // Count only full downloads; range requests are previews/streaming.
    if !headers.contains_key(axum::http::header::RANGE) {
        let db = state.db.clone();
        let uid = user.id;
        tokio::spawn(async move {
            let _ = access::record_download(&db, file_id, uid).await;
        });
    }

    let disposition = format!(
        "attachment; filename=\"{}\"",
        file.name.replace('"', "\\\"")
    );

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, &file.mime_type)
        .header(header::CONTENT_DISPOSITION, disposition)
        .header(header::CONTENT_LENGTH, data.len())
        .body(Body::from(data))
        .expect("valid response"))
}

/// Thumbnail du fichier
pub async fn thumbnail(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
) -> Result<Response> {
    let file = files::get_file_readable(&state.db, user.id, file_id).await?;

    // SVG : on sert directement le fichier vectoriel comme miniature (le navigateur
    // le rend ; les scripts SVG ne s'exécutent pas dans un <img>). Pas de raster.
    if file.mime_type == "image/svg+xml" {
        let data = state.storage.get(&file.storage_path).await?;
        return Ok(Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "image/svg+xml")
            .header(header::CACHE_CONTROL, "public, max-age=86400")
            .body(Body::from(data))
            .expect("valid response"));
    }

    // Génération à la volée si le thumbnail manque (auto-réparation des anciens
    // fichiers : copies/imports passés, vidéos uploadées avant le support vidéo…).
    if !file.has_thumbnail {
        let generated = thumbnails::generate_thumbnail(
            &state.db, &state.storage, file.owner_id, file_id,
            &file.storage_path, &file.mime_type, state.settings.files.thumbnail_size,
        ).await.unwrap_or(false);
        if !generated {
            return Err(FilesError::NotFound("Pas de thumbnail disponible".into()));
        }
    }

    let thumb_path = kubuno_storage::path::user_thumbnail_path(file.owner_id, file_id);
    let data = state.storage.get(&thumb_path.to_string_lossy()).await?;

    // Le thumbnail est en PNG (images transparentes) ou JPEG (opaques) : on déduit
    // le type des octets magiques plutôt que de forcer image/jpeg.
    let content_type = if data.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else {
        "image/jpeg"
    };

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "public, max-age=86400")
        .body(Body::from(data))
        .expect("valid response"))
}

pub async fn rename(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
    Json(dto): Json<RenameFileDto>,
) -> Result<Json<Value>> {
    let old = files::get_file(&state.db, user.id, file_id).await?;
    let file = files::rename_file(&state.db, &state.storage, user.id, file_id, dto).await?;
    activity::log_file(&state.db, file.id, user.id, &user.email, "renamed",
        serde_json::json!({ "old_name": old.name, "new_name": file.name })).await;
    crate::events::notify_change(&state.settings, user.id);
    Ok(Json(json!({ "file": file })))
}

pub async fn move_file(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
    Json(dto): Json<MoveFileDto>,
) -> Result<Json<Value>> {
    let file = files::move_file(&state.db, &state.storage, user.id, file_id, dto).await?;
    activity::log_file(&state.db, file.id, user.id, &user.email, "moved",
        serde_json::json!({})).await;
    crate::events::notify_change(&state.settings, user.id);
    Ok(Json(json!({ "file": file })))
}

pub async fn trash(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
) -> Result<Json<Value>> {
    // A locked file must be explicitly unlocked before it can be trashed.
    if locks::locked_holder(&state.db, file_id).await?.is_some() {
        return Err(FilesError::Conflict(
            "Fichier verrouillé — déverrouillez-le avant de le mettre à la corbeille".into(),
        ));
    }
    let file = files::trash_file(&state.db, user.id, file_id).await?;
    activity::log_file(&state.db, file.id, user.id, &user.email, "trashed",
        serde_json::json!({})).await;
    crate::events::notify_change(&state.settings, user.id);
    Ok(Json(json!({ "file": file })))
}

pub async fn restore(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let file = files::restore_file(&state.db, user.id, file_id).await?;
    activity::log_file(&state.db, file.id, user.id, &user.email, "restored",
        serde_json::json!({})).await;
    crate::events::notify_change(&state.settings, user.id);
    Ok(Json(json!({ "file": file })))
}

pub async fn delete(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
) -> Result<Json<Value>> {
    if locks::locked_holder(&state.db, file_id).await?.is_some() {
        return Err(FilesError::Conflict(
            "Fichier verrouillé — déverrouillez-le avant de le supprimer".into(),
        ));
    }
    files::delete_file_permanently(&state.db, &state.storage, user.id, file_id).await?;
    crate::events::notify_change(&state.settings, user.id);
    Ok(Json(json!({ "ok": true })))
}

pub async fn star(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let file = files::toggle_star_file(&state.db, user.id, file_id).await?;
    Ok(Json(json!({ "file": file })))
}

pub async fn set_open_with(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
    Json(dto): Json<SetOpenWithDto>,
) -> Result<Json<Value>> {
    let file = files::set_open_with(&state.db, user.id, file_id, dto.module_id.as_deref()).await?;
    Ok(Json(json!({ "file": file })))
}

pub async fn update_user_metadata(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
    Json(dto): Json<UserMetadataDto>,
) -> Result<Json<Value>> {
    let mut patch = serde_json::Map::new();
    if let Some(v) = dto.title       { patch.insert("title".into(),       serde_json::json!(v)); }
    if let Some(v) = dto.description { patch.insert("description".into(), serde_json::json!(v)); }
    if let Some(v) = dto.author      { patch.insert("author".into(),      serde_json::json!(v)); }
    if let Some(v) = dto.keywords    { patch.insert("keywords".into(),    serde_json::json!(v)); }
    let file = files::update_user_metadata(&state.db, user.id, file_id, serde_json::Value::Object(patch)).await?;
    Ok(Json(json!({ "file": file })))
}

/// POST /files/:id/copy — copier un fichier dans un dossier cible
pub async fn copy_file(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
    Json(dto): Json<CopyFileDto>,
) -> Result<Json<Value>> {
    let file = files::copy_file(&state.db, &state.storage, user.id, file_id, dto.folder_id).await?;
    activity::log_file(&state.db, file.id, user.id, &user.email, "copied",
        serde_json::json!({ "from": file_id })).await;
    Ok(Json(json!({ "file": file })))
}

/// POST /compress — créer une archive ZIP à partir de fichiers/dossiers
pub async fn compress(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Json(dto): Json<CompressDto>,
) -> Result<axum::response::Response> {
    use axum::http::{header, StatusCode};
    use std::io::Write;

    if dto.file_ids.is_empty() && dto.folder_ids.is_empty() {
        return Err(FilesError::Validation("Aucun élément sélectionné".into()));
    }

    let archive_name = dto.archive_name.unwrap_or_else(|| "archive.zip".to_string());
    let buf = Vec::new();
    let cursor = std::io::Cursor::new(buf);
    let mut zip = zip::ZipWriter::new(cursor);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // Ajouter les fichiers
    for file_id in &dto.file_ids {
        let file = files::get_file(&state.db, user.id, *file_id).await;
        let Ok(file) = file else { continue };
        let data = state.storage.get(&file.storage_path).await;
        let Ok(data) = data else { continue };
        zip.start_file(file.name.clone(), options).ok();
        zip.write_all(&data).ok();
    }

    // Ajouter les dossiers (récursivement, premier niveau)
    for folder_id in &dto.folder_ids {
        let folder_files = files::list_files(&state.db, user.id, crate::models::ListFilesQuery {
            folder_id: Some(*folder_id),
            ..Default::default()
        }).await.unwrap_or_default();

        // Récupérer le nom du dossier
        let folder_name: Option<String> = sqlx::query_scalar(
            "SELECT name FROM drive.folders WHERE id = $1 AND owner_id = $2",
        )
        .bind(folder_id)
        .bind(user.id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
        let prefix = folder_name.unwrap_or_else(|| folder_id.to_string());

        for file in folder_files {
            let data = state.storage.get(&file.storage_path).await;
            let Ok(data) = data else { continue };
            zip.start_file(format!("{}/{}", prefix, file.name), options).ok();
            zip.write_all(&data).ok();
        }
    }

    let cursor = zip.finish().map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;
    let zip_bytes = cursor.into_inner();

    let response = axum::response::Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/zip")
        .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", archive_name))
        .header(header::CONTENT_LENGTH, zip_bytes.len().to_string())
        .body(axum::body::Body::from(zip_bytes))
        .map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;

    Ok(response)
}
