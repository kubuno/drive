use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::Response,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    middleware::FilesUser,
    models::CreateFolderDto,
    services::{archives, files, folders},
    state::AppState,
};

// ── DTOs ──────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CompressSaveDto {
    pub file_ids:     Vec<Uuid>,
    pub folder_ids:   Vec<Uuid>,
    pub archive_name: Option<String>,
    /// Dossier de destination (null = racine)
    pub folder_id:    Option<Uuid>,
    /// Format de l'archive : "zip" (défaut) ou "targz".
    pub format:       Option<String>,
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
    pub name:            String,
    pub path:            String, // chemin complet dans l'archive
    pub is_dir:          bool,
    pub size:            u64,
    pub compressed_size: u64,
}

/// Strips a known archive extension to derive a destination folder name.
fn strip_archive_ext(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    for ext in [".tar.gz", ".tgz", ".tar", ".zip"] {
        if lower.ends_with(ext) {
            return name[..name.len() - ext.len()].to_string();
        }
    }
    name.to_string()
}

// ── POST /archive/compress-save ───────────────────────────────────────────────
/// Compresse des fichiers/dossiers et sauvegarde l'archive dans le drive.
/// Supporte les formats ZIP (défaut) et TAR.GZ.
pub async fn compress_save(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Json(dto): Json<CompressSaveDto>,
) -> Result<Json<Value>> {
    if dto.file_ids.is_empty() && dto.folder_ids.is_empty() {
        return Err(FilesError::Validation("Aucun élément sélectionné".into()));
    }

    let targz = matches!(dto.format.as_deref(), Some("targz") | Some("tar.gz") | Some("tgz"));
    let default_ext = if targz { "tar.gz" } else { "zip" };

    let mut base = sanitize_filename::sanitize(
        dto.archive_name.unwrap_or_else(|| "archive".to_string()),
    );
    if base.is_empty() {
        base = "archive".to_string();
    }
    let archive_name = if base.to_ascii_lowercase().ends_with(default_ext) {
        base
    } else {
        format!("{base}.{default_ext}")
    };

    // Gather every entry into memory, then encode in the chosen format.
    let mut dirs: Vec<String> = Vec::new();
    let mut entries: Vec<(String, Vec<u8>)> = Vec::new();

    for file_id in &dto.file_ids {
        let Ok(file) = files::get_file(&state.db, user.id, *file_id).await else { continue };
        let Ok(data) = state.storage.get(&file.storage_path).await else { continue };
        entries.push((file.name, data.to_vec()));
    }

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
        gather_folder(&state, user.id, *folder_id, prefix, &mut dirs, &mut entries).await;
    }

    let bytes = if targz {
        archives::write_targz(&dirs, &entries)?
    } else {
        archives::write_zip(&dirs, &entries)?
    };
    let mime = if targz { "application/gzip" } else { "application/zip" };
    let archive_bytes = bytes::Bytes::from(bytes);
    let size = archive_bytes.len() as i64;

    let file = files::create_with_bytes(
        &state.db,
        &state.storage,
        user.id,
        dto.folder_id,
        &archive_name,
        mime,
        archive_bytes,
        None,
        false,
    ).await?;

    files::update_used_bytes(&state.db, user.id, size).await;

    Ok(Json(json!({ "file": file })))
}

/// Recursively collects a folder's files (with content) and directory paths.
async fn gather_folder(
    state:    &AppState,
    owner_id: Uuid,
    folder_id: Uuid,
    prefix:   String,
    dirs:     &mut Vec<String>,
    entries:  &mut Vec<(String, Vec<u8>)>,
) {
    dirs.push(prefix.clone());

    let folder_files = files::list_files(&state.db, owner_id, crate::models::ListFilesQuery {
        folder_id: Some(folder_id),
        ..Default::default()
    }).await.unwrap_or_default();

    for file in folder_files {
        let Ok(data) = state.storage.get(&file.storage_path).await else { continue };
        entries.push((format!("{}/{}", prefix, file.name), data.to_vec()));
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
        gather_folder_boxed(state, owner_id, sub_id, sub_prefix, dirs, entries).await;
    }
}

fn gather_folder_boxed<'a>(
    state:    &'a AppState,
    owner_id: Uuid,
    folder_id: Uuid,
    prefix:   String,
    dirs:     &'a mut Vec<String>,
    entries:  &'a mut Vec<(String, Vec<u8>)>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
    Box::pin(gather_folder(state, owner_id, folder_id, prefix, dirs, entries))
}

// ── POST /:id/decompress ──────────────────────────────────────────────────────
/// Décompresse une archive (ZIP, TAR ou TAR.GZ) dans un dossier.
pub async fn decompress(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
    Json(dto): Json<DecompressDto>,
) -> Result<Json<Value>> {
    let file = files::get_file(&state.db, user.id, file_id).await?;

    let kind = archives::detect_kind(&file.name, &file.mime_type).ok_or_else(|| {
        FilesError::Validation("Format d'archive non supporté (ZIP, TAR, TAR.GZ)".into())
    })?;

    let data = state.storage.get(&file.storage_path).await
        .map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;

    let items = tokio::task::block_in_place(|| archives::read_all(kind, data.as_ref()))?;
    drop(data);

    // Dossier de destination
    let base_name = strip_archive_ext(&file.name);
    let create_sub = dto.create_subfolder.unwrap_or(true);

    let dest_folder_id = if create_sub {
        let parent_id = dto.folder_id.or(file.folder_id);
        let folder = folders::create_folder(
            &state.db,
            &state.storage,
            user.id,
            CreateFolderDto { name: base_name, parent_id, id: None },
        ).await?;
        Some(folder.id)
    } else {
        dto.folder_id.or(file.folder_id)
    };

    // Map chemin interne → folder_id créé
    let mut dir_map: std::collections::HashMap<String, Uuid> = std::collections::HashMap::new();
    let mut extracted = 0usize;

    for item in items {
        let name = item.path.trim_end_matches('/').to_string();
        if name.is_empty() { continue }

        if item.is_dir {
            ensure_dirs(&state, user.id, dest_folder_id, &name, &mut dir_map).await?;
        } else {
            let parts: Vec<&str> = name.split('/').collect();
            let file_name = parts.last().copied().unwrap_or("file");

            let parent = if parts.len() > 1 {
                let dir_path = parts[..parts.len() - 1].join("/");
                ensure_dirs(&state, user.id, dest_folder_id, &dir_path, &mut dir_map).await?
            } else {
                dest_folder_id
            };

            let size = item.data.len() as i64;
            let mime = mime_guess::from_path(file_name).first_or_octet_stream().to_string();

            if files::create_with_bytes(
                &state.db,
                &state.storage,
                user.id,
                parent,
                file_name,
                &mime,
                bytes::Bytes::from(item.data),
                None,
                false,
            ).await.is_ok() {
                files::update_used_bytes(&state.db, user.id, size).await;
                extracted += 1;
            }
        }
    }

    crate::events::notify_change(&state.settings, user.id);
    Ok(Json(json!({ "extracted": extracted, "folder_id": dest_folder_id })))
}

/// Ensures every directory along `path` exists under `root`, returning the leaf id.
async fn ensure_dirs(
    state:   &AppState,
    owner_id: Uuid,
    root:    Option<Uuid>,
    path:    &str,
    dir_map: &mut std::collections::HashMap<String, Uuid>,
) -> Result<Option<Uuid>> {
    let mut parent = root;
    let mut path_acc = String::new();
    for part in path.split('/') {
        if part.is_empty() { continue }
        if !path_acc.is_empty() { path_acc.push('/'); }
        path_acc.push_str(part);
        if let Some(&id) = dir_map.get(&path_acc) {
            parent = Some(id);
        } else {
            let created = folders::create_folder(
                &state.db, &state.storage, owner_id,
                CreateFolderDto { name: part.to_string(), parent_id: parent, id: None },
            ).await?;
            dir_map.insert(path_acc.clone(), created.id);
            parent = Some(created.id);
        }
    }
    Ok(parent)
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
    let kind = archives::detect_kind(&file.name, &file.mime_type).ok_or_else(|| {
        FilesError::Validation("Format d'archive non supporté".into())
    })?;
    let data = state.storage.get(&file.storage_path).await
        .map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;

    let index = tokio::task::block_in_place(|| archives::read_index(kind, data.as_ref()))?;
    let total = index.len();

    let prefix = q.path.unwrap_or_default();
    let prefix = prefix.trim_matches('/').to_string();

    let mut entries: Vec<ArchiveEntry> = Vec::new();
    let mut seen_dirs: std::collections::HashSet<String> = std::collections::HashSet::new();

    for e in &index {
        let raw_name = e.path.trim_end_matches('/');

        let relative = if prefix.is_empty() {
            raw_name
        } else if let Some(rest) = raw_name.strip_prefix(&format!("{prefix}/")) {
            rest
        } else {
            continue
        };
        if relative.is_empty() { continue }

        let parts: Vec<&str> = relative.splitn(2, '/').collect();
        let direct_name = parts[0];

        let full_path = if prefix.is_empty() {
            direct_name.to_string()
        } else {
            format!("{prefix}/{direct_name}")
        };

        if parts.len() > 1 || e.is_dir {
            if !seen_dirs.insert(direct_name.to_string()) { continue }
            entries.push(ArchiveEntry {
                name: direct_name.to_string(), path: full_path,
                is_dir: true, size: 0, compressed_size: 0,
            });
        } else {
            entries.push(ArchiveEntry {
                name: direct_name.to_string(), path: full_path,
                is_dir: false, size: e.size, compressed_size: e.size,
            });
        }
    }

    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(Json(json!({ "entries": entries, "path": prefix, "total": total })))
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
    let kind = archives::detect_kind(&file.name, &file.mime_type).ok_or_else(|| {
        FilesError::Validation("Format d'archive non supporté".into())
    })?;
    let data = state.storage.get(&file.storage_path).await
        .map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;

    let path = q.path.trim_matches('/').to_string();
    let buf = tokio::task::block_in_place(|| archives::read_single(kind, data.as_ref(), &path))?;

    let file_name = std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    let mime = mime_guess::from_path(file_name).first_or_octet_stream().to_string();

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", file_name))
        .header(header::CONTENT_LENGTH, buf.len().to_string())
        .body(Body::from(buf))
        .map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;

    Ok(response)
}
