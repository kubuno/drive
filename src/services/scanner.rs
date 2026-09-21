use kubuno_db::{params, DbPool, DbQueryBuilder};
use std::path::{Path, PathBuf};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::errors::{FilesError, Result};
use crate::sync;

#[derive(Debug, Default, serde::Serialize)]
pub struct ScanStats {
    pub folders_added: u32,
    pub files_added: u32,
    pub files_updated: u32,
    pub files_removed: u32,
}

/// Scan tous les propriétaires présents sur le disque.
pub async fn scan_all(db: &DbPool, storage_base: &Path) -> Result<ScanStats> {
    let mut total = ScanStats::default();

    let read_dir = std::fs::read_dir(storage_base).map_err(|e| {
        FilesError::Internal(anyhow::anyhow!("Impossible de lire le répertoire de stockage: {e}"))
    })?;

    for entry in read_dir.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if let Ok(owner_id) = Uuid::parse_str(&name_str) {
            let stats = scan_owner(db, storage_base, owner_id).await?;
            total.folders_added += stats.folders_added;
            total.files_added += stats.files_added;
            total.files_updated += stats.files_updated;
            total.files_removed += stats.files_removed;
        }
    }

    Ok(total)
}

/// Parcourt `{storage_base}/{owner_id}/files/` et reconcilie avec la DB.
pub async fn scan_owner(db: &DbPool, storage_base: &Path, owner_id: Uuid) -> Result<ScanStats> {
    let owner_files_dir = storage_base.join(owner_id.to_string()).join("files");

    if !owner_files_dir.exists() {
        return Ok(ScanStats::default());
    }

    let mut stats = ScanStats::default();

    // ── Collecter les entrées disque ──────────────────────────────────────────
    let mut disk_dirs: Vec<(PathBuf, String)> = Vec::new();
    let mut disk_files: Vec<(PathBuf, String, String)> = Vec::new();

    for entry in WalkDir::new(&owner_files_dir).min_depth(1).follow_links(false).into_iter().flatten() {
        let path = entry.path().to_path_buf();
        let name = entry.file_name().to_string_lossy().to_string();

        if name.starts_with('.') {
            continue;
        }

        if entry.file_type().is_dir() {
            let virt = abs_to_virt(&owner_files_dir, &path);
            disk_dirs.push((path, virt));
        } else if entry.file_type().is_file() {
            let parent_virt =
                abs_to_virt(&owner_files_dir, entry.path().parent().unwrap_or(&owner_files_dir));
            disk_files.push((path, parent_virt, name));
        }
    }

    // ── Synchroniser les dossiers (parents avant enfants) ────────────────────
    disk_dirs.sort_by_key(|(_, vp)| vp.len());

    for (_, virt_path) in &disk_dirs {
        // Existence probed by selecting the id (avoids EXISTS/int-width quirks).
        let exists = db
            .fetch_optional_scalar::<Uuid>(
                "SELECT id FROM drive.folders WHERE owner_id = $1 AND path = $2 LIMIT 1",
                params![owner_id, virt_path],
            )
            .await?
            .is_some();

        if !exists {
            let (parent_id, name) = resolve_parent(db, owner_id, virt_path).await?;

            let id = kubuno_db::new_id();
            let seq = sync::next_seq_on_pool(db).await?;
            let b = db.backend();
            db.execute(
                &format!(
                    "INSERT {}INTO drive.folders (id, owner_id, parent_id, name, path, change_seq)
                     VALUES ($1, $2, $3, $4, $5, $6){}",
                    b.insert_ignore_prefix(),
                    b.on_conflict_do_nothing(&["owner_id", "parent_id", "name"])
                ),
                params![id, owner_id, parent_id, name, virt_path, seq],
            )
            .await?;

            stats.folders_added += 1;
            tracing::info!(owner_id = %owner_id, path = virt_path, "Dossier disque → ajouté en DB");
        }
    }

    // ── Synchroniser les fichiers ─────────────────────────────────────────────
    let mut disk_storage_paths: Vec<String> = Vec::with_capacity(disk_files.len());

    for (abs_path, virt_folder, name) in &disk_files {
        let storage_rel =
            abs_path.strip_prefix(storage_base).unwrap_or(abs_path).to_string_lossy().to_string();

        disk_storage_paths.push(storage_rel.clone());

        let size = abs_path.metadata().map(|m| m.len() as i64).unwrap_or(0);

        let existing = db
            .fetch_optional_as::<crate::models::File>(
                "SELECT * FROM drive.files WHERE owner_id = $1 AND storage_path = $2",
                params![owner_id, &storage_rel],
            )
            .await?;

        if let Some(f) = existing {
            if f.size_bytes != size {
                // A file that grew/shrank on disk is a delta-visible size change;
                // stamp a fresh seq so offline clients pick it up.
                let seq = sync::next_seq_on_pool(db).await?;
                db.execute(
                    "UPDATE drive.files SET size_bytes = $1, change_seq = $2 WHERE id = $3",
                    params![size, seq, f.id],
                )
                .await?;
                // The scanner is a write path like any other: a file that grew on
                // disk consumes more quota. The delta is signed.
                crate::services::files::update_used_bytes(db, owner_id, size - f.size_bytes).await;
                stats.files_updated += 1;
            }
        } else {
            let folder_id: Option<Uuid> = if virt_folder.is_empty() {
                None
            } else {
                db.fetch_optional_scalar::<Uuid>(
                    "SELECT id FROM drive.folders WHERE owner_id = $1 AND path = $2",
                    params![owner_id, virt_folder],
                )
                .await?
            };

            let mime = mime_guess::MimeGuess::from_path(name).first_or_octet_stream().to_string();
            let extension = std::path::Path::new(name.as_str())
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase());

            let id = kubuno_db::new_id();
            let seq = sync::next_seq_on_pool(db).await?;
            let inserted = db
                .execute(
                    "INSERT INTO drive.files
                        (id, owner_id, folder_id, name, extension, mime_type, size_bytes, storage_path, metadata, change_seq)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
                    params![
                        id, owner_id, folder_id, name, extension, mime, size, storage_rel,
                        serde_json::json!({}), seq
                    ],
                )
                .await?;

            // `drive.files` has no natural unique key, so this insert of a fresh
            // id always writes a row; follow the quota by what the DB did.
            if inserted > 0 {
                crate::services::files::update_used_bytes(db, owner_id, size).await;
                stats.files_added += 1;
                tracing::info!(owner_id = %owner_id, name = name, "Fichier disque → ajouté en DB");
            }
        }
    }

    // ── Marquer comme supprimés les fichiers absents du disque ────────────────
    // A data-modifying CTE (`WITH ... UPDATE ... RETURNING`) is PostgreSQL-only;
    // the plain UPDATE's rows_affected is the count on every engine. One shared
    // seq stamps the whole batch (the old per-row trigger bumps).
    let removed = {
        let seq = sync::next_seq_on_pool(db).await?;
        if disk_storage_paths.is_empty() {
            db.execute(
                "UPDATE drive.files SET is_trashed = TRUE, trashed_at = $1, change_seq = $2
                 WHERE owner_id = $3 AND is_trashed = FALSE",
                params![chrono::Utc::now(), seq, owner_id],
            )
            .await?
        } else {
            let mut qb = DbQueryBuilder::new(
                db.backend(),
                "UPDATE drive.files SET is_trashed = TRUE, trashed_at = ",
            );
            qb.push_bind(chrono::Utc::now())
                .push(", change_seq = ")
                .push_bind(seq)
                .push(" WHERE owner_id = ")
                .push_bind(owner_id)
                .push(" AND is_trashed = FALSE AND storage_path NOT IN")
                .push_in(disk_storage_paths.iter().cloned());
            qb.execute(db).await?
        }
    };
    stats.files_removed = removed as u32;

    if stats.files_removed > 0 {
        tracing::info!(
            owner_id = %owner_id,
            count = stats.files_removed,
            "Fichiers absents du disque → mis en corbeille"
        );
    }

    Ok(stats)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Convertit un chemin absolu en chemin virtuel (relatif à owner_files_dir).
fn abs_to_virt(owner_files_dir: &Path, abs: &Path) -> String {
    let rel = abs.strip_prefix(owner_files_dir).unwrap_or(abs);
    let rel_str = rel.to_string_lossy();
    if rel_str.is_empty() {
        String::new()
    } else {
        format!("/{}", rel_str.replace('\\', "/"))
    }
}

/// Résout le parent_id et le nom depuis un chemin virtuel.
async fn resolve_parent(db: &DbPool, owner_id: Uuid, virt_path: &str) -> Result<(Option<Uuid>, String)> {
    let trimmed = virt_path.trim_start_matches('/');
    let (parent_part, name) = match trimmed.rsplit_once('/') {
        Some((p, n)) => (Some(format!("/{p}")), n.to_string()),
        None => (None, trimmed.to_string()),
    };

    let parent_id = match parent_part {
        None => None,
        Some(pp) => {
            db.fetch_optional_scalar::<Uuid>(
                "SELECT id FROM drive.folders WHERE owner_id = $1 AND path = $2",
                params![owner_id, pp],
            )
            .await?
        }
    };

    Ok((parent_id, name))
}
