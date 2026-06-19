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
pub struct ResizeOp {
    pub width:  u32,
    pub height: u32,
    /// Keep aspect ratio, fitting within (width, height). Defaults to true.
    pub keep_aspect: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct CropOp {
    pub x:      u32,
    pub y:      u32,
    pub width:  u32,
    pub height: u32,
}

#[derive(Debug, Deserialize)]
pub struct TransformDto {
    /// Rotation clockwise en degrés : 90, 180, 270
    pub rotate:    Option<i32>,
    pub flip_h:    Option<bool>,
    pub flip_v:    Option<bool>,
    pub resize:    Option<ResizeOp>,
    pub crop:      Option<CropOp>,
    pub grayscale: Option<bool>,
    /// Convert to another format: "jpeg" | "png" | "webp" | "gif".
    pub format:    Option<String>,
    /// Lossy quality 1..=100 (applied to JPEG; ignored for lossless formats).
    pub quality:   Option<u8>,
}

/// Maps a short format name to (ImageFormat, mime, extension).
fn resolve_format(name: &str) -> Option<(image::ImageFormat, &'static str, &'static str)> {
    match name.to_ascii_lowercase().as_str() {
        "jpeg" | "jpg" => Some((image::ImageFormat::Jpeg, "image/jpeg", "jpg")),
        "png"          => Some((image::ImageFormat::Png,  "image/png",  "png")),
        "webp"         => Some((image::ImageFormat::WebP, "image/webp", "webp")),
        "gif"          => Some((image::ImageFormat::Gif,  "image/gif",  "gif")),
        _ => None,
    }
}

/// Replaces a file's trailing extension with `ext` (keeps the base name).
fn swap_extension(name: &str, ext: &str) -> String {
    match name.rfind('.') {
        Some(i) if i > 0 => format!("{}.{}", &name[..i], ext),
        _ => format!("{name}.{ext}"),
    }
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

    // Resolve the output format: explicit `format` wins, otherwise keep the original.
    let (out_format, out_mime, out_ext) = match dto.format.as_deref() {
        Some(name) => resolve_format(name)
            .ok_or_else(|| FilesError::Validation("Format de sortie non supporté".into()))?,
        None => {
            let fmt = image::ImageFormat::from_mime_type(&file.mime_type)
                .unwrap_or(image::ImageFormat::Jpeg);
            // mime/ext unchanged when not converting.
            (fmt, "", "")
        }
    };

    let data      = state.storage.get(&file.storage_path).await?;
    let rotate    = dto.rotate.unwrap_or(0);
    let flip_h    = dto.flip_h.unwrap_or(false);
    let flip_v    = dto.flip_v.unwrap_or(false);
    let grayscale = dto.grayscale.unwrap_or(false);
    let quality   = dto.quality.unwrap_or(85).clamp(1, 100);
    let resize    = dto.resize;
    let crop      = dto.crop;

    let encoded = tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<u8>> {
        use image::imageops::FilterType;
        let mut img = image::load_from_memory(&data)?;

        // Crop first (coordinates relative to the source image), with clamping.
        if let Some(c) = crop {
            let (iw, ih) = (img.width(), img.height());
            if c.x < iw && c.y < ih && c.width > 0 && c.height > 0 {
                let w = c.width.min(iw - c.x);
                let h = c.height.min(ih - c.y);
                img = img.crop_imm(c.x, c.y, w, h);
            }
        }

        // Resize within a sane upper bound to avoid pathological allocations.
        if let Some(r) = resize {
            let w = r.width.clamp(1, 12000);
            let h = r.height.clamp(1, 12000);
            img = if r.keep_aspect.unwrap_or(true) {
                img.resize(w, h, FilterType::Lanczos3)
            } else {
                img.resize_exact(w, h, FilterType::Lanczos3)
            };
        }

        let deg = ((rotate % 360) + 360) % 360;
        img = match deg {
            90  => img.rotate90(),
            180 => img.rotate180(),
            270 => img.rotate270(),
            _   => img,
        };
        if flip_h { img = img.fliph(); }
        if flip_v { img = img.flipv(); }
        if grayscale { img = img.grayscale(); }

        let mut buf = Vec::new();
        if out_format == image::ImageFormat::Jpeg {
            // JPEG honours the quality setting.
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(
                Cursor::new(&mut buf), quality,
            );
            img.write_with_encoder(encoder)?;
        } else {
            img.write_to(&mut Cursor::new(&mut buf), out_format)?;
        }
        Ok(buf)
    })
    .await
    .map_err(|e| FilesError::Internal(anyhow::anyhow!("{e}")))?
    .map_err(FilesError::Internal)?;

    let new_size = encoded.len() as i64;
    state.storage.put(&file.storage_path, Bytes::from(encoded)).await?;

    // When converting, update name/extension/mime; otherwise just the size.
    let updated = if out_mime.is_empty() {
        sqlx::query_as::<_, File>(
            "UPDATE drive.files SET size_bytes = $1, has_thumbnail = FALSE, updated_at = NOW()
             WHERE id = $2 AND owner_id = $3 RETURNING *",
        )
        .bind(new_size)
        .bind(file_id)
        .bind(user.id)
        .fetch_one(&state.db)
        .await?
    } else {
        let new_name = swap_extension(&file.name, out_ext);
        sqlx::query_as::<_, File>(
            "UPDATE drive.files
             SET size_bytes = $1, name = $2, extension = $3, mime_type = $4,
                 has_thumbnail = FALSE, updated_at = NOW()
             WHERE id = $5 AND owner_id = $6 RETURNING *",
        )
        .bind(new_size)
        .bind(&new_name)
        .bind(out_ext)
        .bind(out_mime)
        .bind(file_id)
        .bind(user.id)
        .fetch_one(&state.db)
        .await?
    };

    // Regenerate the thumbnail from the new bytes (best-effort).
    {
        let db      = state.db.clone();
        let storage = state.storage.clone();
        let sp      = updated.storage_path.clone();
        let mime2   = updated.mime_type.clone();
        let ts      = state.settings.files.thumbnail_size;
        tokio::spawn(async move {
            let _ = thumbnails::generate_thumbnail(
                &db, &storage, user.id, file_id, &sp, &mime2, ts,
            ).await;
        });
    }

    crate::events::notify_change(&state.settings, user.id);
    Ok(Json(json!({ "file": updated })))
}
