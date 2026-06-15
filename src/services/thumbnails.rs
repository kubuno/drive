use bytes::Bytes;
use kubuno_storage::{StorageBackend, path as storage_path};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

use crate::errors::Result;

/// Génère un thumbnail pour les images ET les vidéos (JPEG, ou PNG si l'image a
/// de la transparence). Images : décodées via la crate `image`. Vidéos : ffmpeg.
/// Les formats non supportés (ou fichiers illisibles/corrompus) sont ignorés.
pub async fn generate_thumbnail(
    db: &PgPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    file_id: Uuid,
    storage_path_str: &str,
    mime_type: &str,
    thumbnail_size: u32,
) -> Result<bool> {
    // SVG : pas de rastérisation (la crate `image` ne décode pas le vectoriel). Le
    // fichier SVG sert directement de miniature — rendu par le navigateur via le
    // handler `thumbnail`. On marque juste has_thumbnail pour que l'UI l'affiche.
    if mime_type == "image/svg+xml" {
        sqlx::query("UPDATE drive.files SET has_thumbnail = TRUE WHERE id = $1")
            .bind(file_id)
            .execute(db)
            .await?;
        return Ok(true);
    }

    let is_img = is_image(mime_type);
    let is_vid = mime_type.starts_with("video/");
    if !is_img && !is_vid {
        return Ok(false);
    }

    // Charger le fichier depuis le storage
    let data = match storage.get(storage_path_str).await {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!(file_id = %file_id, error = %e, "Cannot load file for thumbnail");
            return Ok(false);
        }
    };

    let size = thumbnail_size;
    let thumb_bytes: Option<Vec<u8>> = if is_img {
        // Décodage raster dans un thread bloquant.
        tokio::task::spawn_blocking(move || -> Option<Vec<u8>> {
            let img = image::load_from_memory(&data).ok()?;
            let thumb = img.thumbnail(size, size);
            let mut buf = Vec::new();
            // Images avec canal alpha (PNG/WebP/GIF transparents) → encoder en PNG
            // pour PRÉSERVER la transparence. Sinon le JPEG (sans alpha) noircit le
            // fond transparent. Images opaques → JPEG (plus compact).
            let fmt = if img.color().has_alpha() {
                image::ImageFormat::Png
            } else {
                image::ImageFormat::Jpeg
            };
            thumb.write_to(&mut std::io::Cursor::new(&mut buf), fmt).ok()?;
            Some(buf)
        })
        .await
        .ok()
        .flatten()
    } else {
        // Vidéo : extraction d'une image via ffmpeg.
        video_thumbnail(data, size).await
    };

    if let Some(thumb) = thumb_bytes {
        let thumb_path = storage_path::user_thumbnail_path(owner_id, file_id);
        let thumb_path_str = thumb_path.to_string_lossy().to_string();

        if let Err(e) = storage.put(&thumb_path_str, Bytes::from(thumb)).await {
            tracing::warn!(file_id = %file_id, error = %e, "Cannot save thumbnail");
            return Ok(false);
        }

        sqlx::query("UPDATE drive.files SET has_thumbnail = TRUE WHERE id = $1")
            .bind(file_id)
            .execute(db)
            .await?;

        return Ok(true);
    }

    Ok(false)
}

/// Extrait une image d'aperçu d'une vidéo via ffmpeg (frame à ~1 s, sinon la première).
/// Retourne le JPEG, ou None si la vidéo est illisible / trop courte / corrompue.
async fn video_thumbnail(data: Bytes, size: u32) -> Option<Vec<u8>> {
    let uid = Uuid::new_v4();
    let dir = std::env::temp_dir();
    let in_path = dir.join(format!("kfthumb_{uid}_in"));
    let out_path = dir.join(format!("kfthumb_{uid}.jpg"));

    if tokio::fs::write(&in_path, &data).await.is_err() {
        return None;
    }

    let vf = format!("scale={size}:{size}:force_original_aspect_ratio=decrease");
    let run_at = |seek: Option<&'static str>| {
        let mut cmd = tokio::process::Command::new("ffmpeg");
        cmd.arg("-y").args(["-loglevel", "error"]);
        if let Some(s) = seek { cmd.args(["-ss", s]); }
        cmd.arg("-i").arg(&in_path)
            .args(["-frames:v", "1", "-vf", &vf])
            .arg(&out_path);
        cmd.status()
    };

    // Frame à 1 s (plus représentative qu'une éventuelle première frame noire).
    let mut thumb = match run_at(Some("1")).await {
        Ok(s) if s.success() => tokio::fs::read(&out_path).await.ok(),
        _ => None,
    };
    // Repli : vidéo < 1 s → première frame.
    if thumb.as_ref().map(|b| b.is_empty()).unwrap_or(true) {
        let _ = run_at(None).await;
        thumb = tokio::fs::read(&out_path).await.ok();
    }

    let _ = tokio::fs::remove_file(&in_path).await;
    let _ = tokio::fs::remove_file(&out_path).await;
    thumb.filter(|b| !b.is_empty())
}

fn is_image(mime: &str) -> bool {
    matches!(
        mime,
        "image/jpeg" | "image/png" | "image/gif" | "image/webp" |
        "image/bmp" | "image/tiff"
    )
}
