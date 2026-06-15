use axum::{extract::{Path, State}, Extension, Json};
use bytes::Bytes;
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::Cursor;
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    middleware::FilesUser,
    models::file::File,
    services::{files, thumbnails},
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct TransformDto {
    /// Rotation clockwise en degrés : 90, 180, 270
    pub rotate: Option<i32>,
    pub flip_h: Option<bool>,
    pub flip_v: Option<bool>,
}

pub async fn transform(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
    Json(dto): Json<TransformDto>,
) -> Result<Json<Value>> {
    let file = files::get_file(&state.db, user.id, file_id).await?;

    if !file.mime_type.starts_with("image/") {
        return Err(FilesError::Validation("Ce fichier n'est pas une image".into()));
    }

    let data   = state.storage.get(&file.storage_path).await?;
    let rotate = dto.rotate.unwrap_or(0);
    let flip_h = dto.flip_h.unwrap_or(false);
    let flip_v = dto.flip_v.unwrap_or(false);
    let mime   = file.mime_type.clone();

    let encoded = tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<u8>> {
        let mut img = image::load_from_memory(&data)?;

        let deg = ((rotate % 360) + 360) % 360;
        img = match deg {
            90  => img.rotate90(),
            180 => img.rotate180(),
            270 => img.rotate270(),
            _   => img,
        };
        if flip_h { img = img.fliph(); }
        if flip_v { img = img.flipv(); }

        let fmt = image::ImageFormat::from_mime_type(&mime)
            .unwrap_or(image::ImageFormat::Jpeg);
        let mut buf = Vec::new();
        img.write_to(&mut Cursor::new(&mut buf), fmt)?;
        Ok(buf)
    })
    .await
    .map_err(|e| FilesError::Internal(anyhow::anyhow!("{e}")))?
    .map_err(FilesError::Internal)?;

    let new_size = encoded.len() as i64;
    state.storage.put(&file.storage_path, Bytes::from(encoded)).await?;

    let updated = sqlx::query_as::<_, File>(
        "UPDATE drive.files SET size_bytes = $1, updated_at = NOW()
         WHERE id = $2 AND owner_id = $3 RETURNING *",
    )
    .bind(new_size)
    .bind(file_id)
    .bind(user.id)
    .fetch_one(&state.db)
    .await?;

    // Régénérer le thumbnail (best-effort)
    {
        let db      = state.db.clone();
        let storage = state.storage.clone();
        let sp      = file.storage_path.clone();
        let mime2   = file.mime_type.clone();
        let ts      = state.settings.files.thumbnail_size;
        tokio::spawn(async move {
            let _ = thumbnails::generate_thumbnail(
                &db, &storage, user.id, file_id, &sp, &mime2, ts,
            ).await;
        });
    }

    Ok(Json(json!({ "file": updated })))
}
