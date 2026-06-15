use bytes::Bytes;
use kubuno_storage::{StorageBackend, path as storage_path};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    models::{File, InitUploadDto, UploadSession},
    services::files::{create_file_record, resolve_name},
};

pub async fn init_upload(
    db: &PgPool,
    _storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    dto: InitUploadDto,
    max_upload_bytes: u64,
    chunk_size: u64,
) -> Result<UploadSession> {
    if dto.total_size as u64 > max_upload_bytes {
        return Err(FilesError::FileTooLarge);
    }
    if dto.total_size <= 0 {
        return Err(FilesError::Validation("Taille invalide".into()));
    }

    let session_id = Uuid::new_v4();
    let effective_chunk_size = if dto.chunk_size > 0 {
        dto.chunk_size
    } else {
        chunk_size as i64
    };
    let total_chunks = ((dto.total_size as f64) / (effective_chunk_size as f64)).ceil() as i32;

    let temp_path     = storage_path::upload_temp_dir_v2(session_id);
    let temp_path_str = temp_path.to_string_lossy().to_string();

    let mime = dto.mime_type
        .unwrap_or_else(|| mime_guess::MimeGuess::from_path(&dto.filename)
            .first_or_octet_stream()
            .to_string());

    let safe_name = sanitize_filename::sanitize(&dto.filename);
    if safe_name.is_empty() {
        return Err(FilesError::Validation("Nom de fichier invalide".into()));
    }

    let session = sqlx::query_as::<_, UploadSession>(
        "INSERT INTO drive.upload_sessions
            (id, owner_id, folder_id, filename, mime_type, total_size, chunk_size, total_chunks, temp_path, overwrite)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *"
    )
    .bind(session_id)
    .bind(owner_id)
    .bind(dto.folder_id)
    .bind(&safe_name)
    .bind(&mime)
    .bind(dto.total_size)
    .bind(effective_chunk_size)
    .bind(total_chunks)
    .bind(&temp_path_str)
    .bind(dto.overwrite)
    .fetch_one(db)
    .await?;

    Ok(session)
}

pub async fn upload_chunk(
    db: &PgPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    session_id: Uuid,
    chunk_index: u32,
    data: Bytes,
) -> Result<UploadSession> {
    let session = get_session(db, owner_id, session_id).await?;

    if session.status != "pending" && session.status != "uploading" {
        return Err(FilesError::Validation(format!(
            "Session en état '{}' ne peut pas recevoir de chunks", session.status
        )));
    }
    if chunk_index >= session.total_chunks as u32 {
        return Err(FilesError::Validation(format!(
            "chunk_index {} dépasse total_chunks {}", chunk_index, session.total_chunks
        )));
    }

    let chunk_path     = storage_path::chunk_path_v2(session_id, chunk_index);
    let chunk_path_str = chunk_path.to_string_lossy().to_string();
    storage.put(&chunk_path_str, data).await?;

    let updated = sqlx::query_as::<_, UploadSession>(
        "UPDATE drive.upload_sessions
         SET status = 'uploading', chunks_received = chunks_received + 1
         WHERE id = $1 AND owner_id = $2 RETURNING *"
    )
    .bind(session_id)
    .bind(owner_id)
    .fetch_one(db)
    .await?;

    Ok(updated)
}

pub async fn complete_upload(
    db: &PgPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    session_id: Uuid,
) -> Result<File> {
    let session = get_session(db, owner_id, session_id).await?;

    if session.chunks_received < session.total_chunks {
        return Err(FilesError::Validation(format!(
            "{}/{} chunks reçus", session.chunks_received, session.total_chunks
        )));
    }

    sqlx::query("UPDATE drive.upload_sessions SET status = 'assembling' WHERE id = $1")
        .bind(session_id)
        .execute(db)
        .await?;

    // Chemin de destination style Nextcloud
    let folder_virt_path = match session.folder_id {
        None => String::new(),
        Some(fid) => sqlx::query_scalar::<_, String>(
            "SELECT path FROM drive.folders WHERE id = $1 AND owner_id = $2"
        )
        .bind(fid)
        .bind(owner_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| FilesError::NotFound("Dossier cible introuvable".into()))?,
    };

    let safe_filename = resolve_name(db, storage, owner_id, session.folder_id, &session.filename, session.overwrite, false).await?;

    let dest_path = storage_path::user_file_path(owner_id, &folder_virt_path, &safe_filename);
    let dest_str  = dest_path.to_string_lossy().to_string();

    // Assembler les chunks
    let mut assembled = bytes::BytesMut::new();
    for i in 0..session.total_chunks as u32 {
        let chunk_path     = storage_path::chunk_path_v2(session_id, i);
        let chunk_path_str = chunk_path.to_string_lossy().to_string();
        let chunk = storage.get(&chunk_path_str).await.map_err(|e| {
            tracing::error!(session_id = %session_id, chunk = i, error = %e, "Missing chunk");
            FilesError::Internal(anyhow::anyhow!("Chunk {i} manquant"))
        })?;
        assembled.extend_from_slice(&chunk);
    }

    let final_data = assembled.freeze();
    let size       = final_data.len() as i64;

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&final_data);
    let hash = hex::encode(hasher.finalize());

    storage.put(&dest_str, final_data).await?;

    // Nettoyer les chunks temporaires
    let temp_dir = storage_path::upload_temp_dir_v2(session_id);
    let _ = storage.delete_dir(&temp_dir.to_string_lossy()).await;

    let file = create_file_record(
        db,
        owner_id,
        session.folder_id,
        &safe_filename,
        &session.mime_type,
        size,
        &dest_str,
        Some(&hash),
    )
    .await?;

    sqlx::query(
        "UPDATE drive.upload_sessions SET status = 'done', file_id = $1 WHERE id = $2"
    )
    .bind(file.id)
    .bind(session_id)
    .execute(db)
    .await?;

    Ok(file)
}

pub async fn abort_upload(
    db: &PgPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    session_id: Uuid,
) -> Result<()> {
    let _session = get_session(db, owner_id, session_id).await?;

    let temp_dir = storage_path::upload_temp_dir_v2(session_id);
    let _ = storage.delete_dir(&temp_dir.to_string_lossy()).await;

    sqlx::query(
        "UPDATE drive.upload_sessions SET status = 'failed', error = 'Annulé' WHERE id = $1"
    )
    .bind(session_id)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn get_session(
    db: &PgPool,
    owner_id: Uuid,
    session_id: Uuid,
) -> Result<UploadSession> {
    sqlx::query_as::<_, UploadSession>(
        "SELECT * FROM drive.upload_sessions WHERE id = $1 AND owner_id = $2"
    )
    .bind(session_id)
    .bind(owner_id)
    .fetch_optional(db)
    .await?
    .ok_or(FilesError::UploadNotFound)
}
