use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::Response,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{Read, Write};
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    middleware::FilesUser,
    models::CreateFolderDto,
    services::{files, folders},
    state::AppState,
};

// ── DTOs ──────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CompressSaveDto {
    pub file_ids:    Vec<Uuid>,
    pub folder_ids:  Vec<Uuid>,
    pub archive_name: Option<String>,
    /// Dossier de destination (null = racine)
    pub folder_id:   Option<Uuid>,
}

#[derive(Deserialize)]
pub struct DecompressDto {
    /// Dossier de destination (null = même dossier que l'archive)
    pub folder_id: Option<Uuid>,
    /// Si true, extraire dans un sous-dossier portant le nom de l'archive
    pub create_subfolder: Option<bool>,
}

#[derive(Deserialize)]
pub struct ArchiveListQuery {
    /// Chemin interne dans l'archive ("" = racine)
    pub path: Option<String>,
}

#[derive(Serialize)]
pub struct ArchiveEntry {
    pub name:         String,
    pub path:         String,      // chemin complet dans l'archive
    pub is_dir:       bool,
    pub size:         u64,
    pub compressed_size: u64,
}

// ── POST /archive/compress-save ───────────────────────────────────────────────
/// Compresse des fichiers/dossiers et sauvegarde l'archive dans le drive.
pub async fn compress_save(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Json(dto): Json<CompressSaveDto>,
) -> Result<Json<Value>> {
    use zip::write::SimpleFileOptions;

    if dto.file_ids.is_empty() && dto.folder_ids.is_empty() {
        return Err(FilesError::Validation("Aucun élément sélectionné".into()));
    }

    let archive_name = sanitize_filename::sanitize(
        dto.archive_name.unwrap_or_else(|| "archive.zip".to_string())
    );
    let archive_name = if archive_name.ends_with(".zip") {
        archive_name
    } else {
        format!("{}.zip", archive_name)
    };

    let buf  = Vec::new();
    let cursor = std::io::Cursor::new(buf);
    let mut zip = zip::ZipWriter::new(cursor);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // Ajouter les fichiers individuels
    for file_id in &dto.file_ids {
        let Ok(file) = files::get_file(&state.db, user.id, *file_id).await else { continue };
        let Ok(data) = state.storage.get(&file.storage_path).await else { continue };
        let _ = zip.start_file(&file.name, options);
        let _ = zip.write_all(&data);
    }

    // Ajouter les dossiers récursivement
    for folder_id in &dto.folder_ids {
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
        add_folder_to_zip(&state, user.id, *folder_id, prefix, &mut zip, options).await;
    }

    let cursor = zip.finish()
        .map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;
    let zip_bytes = bytes::Bytes::from(cursor.into_inner());
    let size = zip_bytes.len() as i64;

    // Sauvegarder dans le drive
    let file = files::create_with_bytes(
        &state.db,
        &state.storage,
        user.id,
        dto.folder_id,
        &archive_name,
        "application/zip",
        zip_bytes,
        None,
        false,
    ).await?;

    files::update_used_bytes(&state.db, user.id, size).await;

    Ok(Json(json!({ "file": file })))
}

/// Ajoute récursivement le contenu d'un dossier dans le ZIP.
async fn add_folder_to_zip(
    state:    &AppState,
    owner_id: Uuid,
    folder_id: Uuid,
    prefix:   String,
    zip:      &mut zip::ZipWriter<std::io::Cursor<Vec<u8>>>,
    options:  zip::write::SimpleFileOptions,
) {
    let _ = zip.add_directory(format!("{}/", prefix), zip::write::SimpleFileOptions::default());

    let folder_files = files::list_files(&state.db, owner_id, crate::models::ListFilesQuery {
        folder_id: Some(folder_id),
        ..Default::default()
    }).await.unwrap_or_default();

    for file in folder_files {
        let Ok(data) = state.storage.get(&file.storage_path).await else { continue };
        let entry_path = format!("{}/{}", prefix, file.name);
        let _ = zip.start_file(&entry_path, options);
        let _ = zip.write_all(&data);
    }

    let subfolders: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT id, name FROM drive.folders WHERE parent_id = $1 AND owner_id = $2 AND is_trashed = FALSE",
    )
    .bind(folder_id)
    .bind(owner_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    for (sub_id, sub_name) in subfolders {
        let sub_prefix = format!("{}/{}", prefix, sub_name);
        add_folder_to_zip_boxed(state, owner_id, sub_id, sub_prefix, zip, options).await;
    }
}

fn add_folder_to_zip_boxed<'a>(
    state:    &'a AppState,
    owner_id: Uuid,
    folder_id: Uuid,
    prefix:   String,
    zip:      &'a mut zip::ZipWriter<std::io::Cursor<Vec<u8>>>,
    options:  zip::write::SimpleFileOptions,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
    Box::pin(add_folder_to_zip(state, owner_id, folder_id, prefix, zip, options))
}

// ── POST /:id/decompress ──────────────────────────────────────────────────────
/// Décompresse une archive ZIP dans un dossier.
pub async fn decompress(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
    Json(dto): Json<DecompressDto>,
) -> Result<Json<Value>> {
    let file = files::get_file(&state.db, user.id, file_id).await?;

    if !file.mime_type.contains("zip") && !file.name.ends_with(".zip") {
        return Err(FilesError::Validation("Seuls les fichiers ZIP sont supportés".into()));
    }

    let data = state.storage.get(&file.storage_path).await
        .map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;

    // Collecter toutes les entrées de manière synchrone (pas d'await pendant que ZipArchive est vivant)
    let entries: Vec<(String, bool, Vec<u8>)> = {
        let cursor = std::io::Cursor::new(data.as_ref());
        let mut zip = zip::ZipArchive::new(cursor)
            .map_err(|e| FilesError::Validation(format!("Archive invalide : {}", e)))?;

        let mut result = Vec::with_capacity(zip.len());
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i)
                .map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;
            let name = entry.name().to_string();
            let is_dir = entry.is_dir();
            let mut buf = Vec::new();
            if !is_dir {
                entry.read_to_end(&mut buf)
                    .map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;
            }
            result.push((name, is_dir, buf));
        }
        result
        // zip et cursor sont droppés ici, avant tout await
    };
    drop(data);

    // Dossier de destination
    let base_name = file.name.trim_end_matches(".zip").to_string();
    let create_sub = dto.create_subfolder.unwrap_or(true);

    let dest_folder_id = if create_sub {
        let parent_id = dto.folder_id.or(file.folder_id);
        let folder = folders::create_folder(
            &state.db,
            &state.storage,
            user.id,
            CreateFolderDto { name: base_name, parent_id },
        ).await?;
        Some(folder.id)
    } else {
        dto.folder_id.or(file.folder_id)
    };

    // Map chemin interne → folder_id créé
    let mut dir_map: std::collections::HashMap<String, Uuid> = std::collections::HashMap::new();
    let mut extracted = 0usize;

    for (raw_name, is_dir, buf) in entries {
        let name = raw_name.trim_end_matches('/').to_string();

        if is_dir {
            let parts: Vec<&str> = name.split('/').collect();
            let mut parent = dest_folder_id;
            let mut path_acc = String::new();
            for part in parts {
                if part.is_empty() { continue }
                if !path_acc.is_empty() { path_acc.push('/'); }
                path_acc.push_str(part);
                if let Some(&id) = dir_map.get(&path_acc) {
                    parent = Some(id);
                } else {
                    let created = folders::create_folder(
                        &state.db, &state.storage, user.id,
                        CreateFolderDto { name: part.to_string(), parent_id: parent },
                    ).await?;
                    dir_map.insert(path_acc.clone(), created.id);
                    parent = Some(created.id);
                }
            }
        } else {
            let parts: Vec<&str> = name.split('/').collect();
            let file_name = parts.last().copied().unwrap_or("file");

            let parent = if parts.len() > 1 {
                let mut parent = dest_folder_id;
                let mut path_acc = String::new();
                for part in &parts[..parts.len() - 1] {
                    if part.is_empty() { continue }
                    if !path_acc.is_empty() { path_acc.push('/'); }
                    path_acc.push_str(part);
                    if let Some(&id) = dir_map.get(&path_acc) {
                        parent = Some(id);
                    } else {
                        let created = folders::create_folder(
                            &state.db, &state.storage, user.id,
                            CreateFolderDto { name: part.to_string(), parent_id: parent },
                        ).await?;
                        dir_map.insert(path_acc.clone(), created.id);
                        parent = Some(created.id);
                    }
                }
                parent
            } else {
                dest_folder_id
            };

            let size = buf.len() as i64;
            let mime = mime_guess::from_path(file_name)
                .first_or_octet_stream()
                .to_string();

            if files::create_with_bytes(
                &state.db,
                &state.storage,
                user.id,
                parent,
                file_name,
                &mime,
                bytes::Bytes::from(buf),
                None,
                false,
            ).await.is_ok() {
                files::update_used_bytes(&state.db, user.id, size).await;
                extracted += 1;
            }
        }
    }

    Ok(Json(json!({ "extracted": extracted, "folder_id": dest_folder_id })))
}

// ── GET /:id/archive/list ─────────────────────────────────────────────────────
/// Liste le contenu d'une archive à un chemin donné (sans extraire).
pub async fn list_archive(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
    Query(q): Query<ArchiveListQuery>,
) -> Result<Json<Value>> {
    let file = files::get_file(&state.db, user.id, file_id).await?;
    let data = state.storage.get(&file.storage_path).await
        .map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;

    let cursor = std::io::Cursor::new(data.as_ref());
    let mut zip = zip::ZipArchive::new(cursor)
        .map_err(|e| FilesError::Validation(format!("Archive invalide : {}", e)))?;

    let prefix = q.path.unwrap_or_default();
    let prefix = prefix.trim_matches('/').to_string();

    // Collecter les entrées directes (pas les sous-entrées)
    let mut entries: Vec<ArchiveEntry> = Vec::new();
    let mut seen_dirs: std::collections::HashSet<String> = std::collections::HashSet::new();

    for i in 0..zip.len() {
        let entry = zip.by_index(i)
            .map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;

        let raw_name = entry.name().trim_end_matches('/').to_string();

        // Filtrer par préfixe
        let relative = if prefix.is_empty() {
            raw_name.as_str()
        } else if raw_name.starts_with(&format!("{}/", prefix)) {
            &raw_name[prefix.len() + 1..]
        } else {
            continue
        };

        if relative.is_empty() { continue }

        // Seuls les éléments directs (pas de sous-chemin)
        let parts: Vec<&str> = relative.splitn(2, '/').collect();
        let direct_name = parts[0];

        if parts.len() > 1 || entry.is_dir() {
            // C'est un répertoire direct ou un chemin plus profond
            if seen_dirs.contains(direct_name) { continue }
            seen_dirs.insert(direct_name.to_string());

            let full_path = if prefix.is_empty() {
                direct_name.to_string()
            } else {
                format!("{}/{}", prefix, direct_name)
            };

            entries.push(ArchiveEntry {
                name:            direct_name.to_string(),
                path:            full_path,
                is_dir:          true,
                size:            0,
                compressed_size: 0,
            });
        } else {
            // Fichier direct
            let full_path = if prefix.is_empty() {
                direct_name.to_string()
            } else {
                format!("{}/{}", prefix, direct_name)
            };

            entries.push(ArchiveEntry {
                name:            direct_name.to_string(),
                path:            full_path,
                is_dir:          false,
                size:            entry.size(),
                compressed_size: entry.compressed_size(),
            });
        }
    }

    // Tri : dossiers d'abord, puis alphabétique
    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(Json(json!({
        "entries": entries,
        "path":    prefix,
        "total":   zip.len(),
    })))
}

// ── GET /:id/archive/file ─────────────────────────────────────────────────────
/// Streame un fichier individuel depuis l'archive (sans tout extraire).
#[derive(Deserialize)]
pub struct ArchiveFileQuery {
    pub path: String,
}

pub async fn get_archive_file(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
    Query(q): Query<ArchiveFileQuery>,
) -> Result<Response> {
    let file = files::get_file(&state.db, user.id, file_id).await?;
    let data = state.storage.get(&file.storage_path).await
        .map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;

    let cursor = std::io::Cursor::new(data.as_ref());
    let mut zip = zip::ZipArchive::new(cursor)
        .map_err(|e| FilesError::Validation(format!("Archive invalide : {}", e)))?;

    let path = q.path.trim_matches('/').to_string();

    let mut entry = zip.by_name(&path)
        .map_err(|_| FilesError::NotFound(format!("Fichier '{}' introuvable dans l'archive", path)))?;

    let mut buf = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut buf)
        .map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;

    let file_name = std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");

    let mime = mime_guess::from_path(file_name)
        .first_or_octet_stream()
        .to_string();

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", file_name),
        )
        .header(header::CONTENT_LENGTH, buf.len().to_string())
        .body(Body::from(buf))
        .map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;

    Ok(response)
}
