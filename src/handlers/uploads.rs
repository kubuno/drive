use axum::{
    extract::{Multipart, Path, State},
    Extension, Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    middleware::FilesUser,
    models::InitUploadDto,
    services::{thumbnails, uploads},
    state::AppState,
};

pub async fn init(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Json(dto): Json<InitUploadDto>,
) -> Result<Json<Value>> {
    let chunk_size = state.settings.files.chunk_size;
    let max = state.settings.files.max_upload_bytes;
    let session = uploads::init_upload(&state.db, &state.storage, user.id, dto, max, chunk_size).await?;
    Ok(Json(json!({ "upload": session })))
}

pub async fn upload_chunk(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path((session_id, chunk_index)): Path<(Uuid, u32)>,
    mut multipart: Multipart,
) -> Result<Json<Value>> {
    let mut chunk_data = None;

    while let Some(field) = multipart.next_field().await
        .map_err(|e| FilesError::Validation(e.to_string()))?
    {
        if field.name() == Some("chunk") {
            let bytes = field.bytes().await
                .map_err(|e| FilesError::Validation(e.to_string()))?;
            chunk_data = Some(bytes);
        }
    }

    let data = chunk_data.ok_or_else(|| FilesError::Validation("Champ 'chunk' manquant".into()))?;
    let session = uploads::upload_chunk(&state.db, &state.storage, user.id, session_id, chunk_index, data).await?;
    Ok(Json(json!({ "upload": session })))
}

pub async fn complete(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let file = uploads::complete_upload(&state.db, &state.storage, user.id, session_id).await?;

    // Thumbnail en arrière-plan
    let db2        = state.db.clone();
    let storage2   = state.storage.clone();
    let thumb_size = state.settings.files.thumbnail_size;
    let file_id    = file.id;
    let owner_id   = file.owner_id;
    let storage_path = file.storage_path.clone();
    let mime       = file.mime_type.clone();
    tokio::spawn(async move {
        let _ = thumbnails::generate_thumbnail(
            &db2, &storage2, owner_id, file_id, &storage_path, &mime, thumb_size
        ).await;
    });

    Ok(Json(json!({ "file": file })))
}

pub async fn abort(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<Value>> {
    uploads::abort_upload(&state.db, &state.storage, user.id, session_id).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn status(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let session = uploads::get_session(&state.db, user.id, session_id).await?;
    Ok(Json(json!({ "upload": session })))
}
