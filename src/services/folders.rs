use kubuno_storage::{StorageBackend, path as storage_path, unique_dir_name};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    models::{CreateFolderDto, Folder, FolderAncestor, FolderSize, MoveFileDto, MoveFolderDto, RenameFolderDto, SetFolderColorDto},
    services::files,
};

pub async fn create_folder(
    db: &PgPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    dto: CreateFolderDto,
) -> Result<Folder> {
    let base_name = dto.name.trim().to_string();
    validate_folder_name(&base_name)?;

    let parent_path = if let Some(parent_id) = dto.parent_id {
        let parent = sqlx::query_as::<_, Folder>(
            "SELECT * FROM drive.folders WHERE id = $1 AND owner_id = $2"
        )
        .bind(parent_id)
        .bind(owner_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| FilesError::NotFound("Dossier parent introuvable".into()))?;
        parent.path.trim_end_matches('/').to_string()
    } else {
        String::new()
    };

    // Éviter les collisions de noms dans le même parent
    let existing_names: Vec<String> = if let Some(pid) = dto.parent_id {
        sqlx::query_scalar(
            "SELECT name FROM drive.folders WHERE owner_id = $1 AND parent_id = $2"
        )
        .bind(owner_id)
        .bind(pid)
        .fetch_all(db)
        .await?
    } else {
        sqlx::query_scalar(
            "SELECT name FROM drive.folders WHERE owner_id = $1 AND parent_id IS NULL"
        )
        .bind(owner_id)
        .fetch_all(db)
        .await?
    };
    let name = unique_dir_name(&base_name, &existing_names);
    let path = if parent_path.is_empty() { format!("/{name}") } else { format!("{parent_path}/{name}") };

    let folder = sqlx::query_as::<_, Folder>(
        "INSERT INTO drive.folders (owner_id, parent_id, name, path)
         VALUES ($1, $2, $3, $4)
         RETURNING *"
    )
    .bind(owner_id)
    .bind(dto.parent_id)
    .bind(&name)
    .bind(&path)
    .fetch_one(db)
    .await?;

    // Créer le répertoire physique (style Nextcloud)
    let dir = storage_path::user_folder_dir(owner_id, &folder.path);
    if let Err(e) = storage.create_dir(&dir.to_string_lossy()).await {
        tracing::warn!(path = %dir.display(), error = %e, "Could not create folder directory");
    }

    Ok(folder)
}

pub async fn list_folders(
    db: &PgPool,
    owner_id: Uuid,
    parent_id: Option<Uuid>,
    trashed: bool,
) -> Result<Vec<Folder>> {
    let folders = if trashed {
        // Vue corbeille : tous les dossiers à la racine de la corbeille (is_trashed = TRUE)
        sqlx::query_as::<_, Folder>(
            "SELECT * FROM drive.folders
             WHERE owner_id = $1 AND is_trashed = TRUE
             ORDER BY name ASC"
        )
        .bind(owner_id)
        .fetch_all(db)
        .await?
    } else if parent_id.is_some() {
        sqlx::query_as::<_, Folder>(
            "SELECT * FROM drive.folders
             WHERE owner_id = $1 AND parent_id = $2 AND is_trashed = FALSE AND is_hidden = FALSE
             ORDER BY name ASC"
        )
        .bind(owner_id)
        .bind(parent_id)
        .fetch_all(db)
        .await?
    } else {
        sqlx::query_as::<_, Folder>(
            "SELECT * FROM drive.folders
             WHERE owner_id = $1 AND parent_id IS NULL AND is_trashed = FALSE AND is_hidden = FALSE
             ORDER BY name ASC"
        )
        .bind(owner_id)
        .fetch_all(db)
        .await?
    };
    Ok(folders)
}

/// Liste les dossiers triés par taille récursive décroissante (dossier + descendants).
/// Utilisé par la page « Espace de stockage » (onglet Répertoires).
pub async fn list_folders_by_size(
    db: &PgPool,
    owner_id: Uuid,
    limit: i64,
) -> Result<Vec<FolderSize>> {
    let rows = sqlx::query_as::<_, FolderSize>(
        r#"SELECT f.id, f.name, f.path,
                  COALESCE(SUM(fl.size_bytes), 0)::bigint AS total_size,
                  COUNT(fl.id)::bigint                    AS file_count
           FROM drive.folders f
           LEFT JOIN drive.folders d
             ON d.owner_id = f.owner_id
            AND d.is_trashed = FALSE
            AND (d.path = f.path OR left(d.path, length(f.path) + 1) = f.path || '/')
           LEFT JOIN drive.files fl
             ON fl.folder_id = d.id AND fl.is_trashed = FALSE
           WHERE f.owner_id = $1 AND f.is_trashed = FALSE
           GROUP BY f.id, f.name, f.path
           ORDER BY total_size DESC, f.name ASC
           LIMIT $2"#,
    )
    .bind(owner_id)
    .bind(limit.clamp(1, 1000))
    .fetch_all(db)
    .await?;
    Ok(rows)
}

pub async fn trash_folder(
    db: &PgPool,
    owner_id: Uuid,
    folder_id: Uuid,
) -> Result<Folder> {
    let folder = get_folder(db, owner_id, folder_id).await?;
    if folder.is_protected {
        return Err(FilesError::Forbidden);
    }
    let protected = protected_descendants(db, owner_id, folder_id).await?;
    if !protected.is_empty() {
        return Err(FilesError::Protected(protected_block_msg(&folder.name, &protected)));
    }
    sqlx::query_as::<_, Folder>(
        "UPDATE drive.folders SET is_trashed = TRUE, trashed_at = NOW()
         WHERE id = $1 AND owner_id = $2 RETURNING *"
    )
    .bind(folder_id)
    .bind(owner_id)
    .fetch_one(db)
    .await
    .map_err(FilesError::from)
}

pub async fn restore_folder(
    db: &PgPool,
    owner_id: Uuid,
    folder_id: Uuid,
) -> Result<Folder> {
    sqlx::query_as::<_, Folder>(
        "UPDATE drive.folders SET is_trashed = FALSE, trashed_at = NULL
         WHERE id = $1 AND owner_id = $2 RETURNING *"
    )
    .bind(folder_id)
    .bind(owner_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| FilesError::NotFound(format!("Dossier {folder_id} introuvable")))
}

pub async fn get_folder(db: &PgPool, owner_id: Uuid, folder_id: Uuid) -> Result<Folder> {
    sqlx::query_as::<_, Folder>(
        "SELECT * FROM drive.folders WHERE id = $1 AND owner_id = $2"
    )
    .bind(folder_id)
    .bind(owner_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| FilesError::NotFound(format!("Dossier {folder_id} introuvable")))
}

/// Retourne les ancêtres du dossier, du plus ancien (racine) au plus proche (parent immédiat).
pub async fn protected_descendants(db: &PgPool, owner_id: Uuid, folder_id: Uuid) -> Result<Vec<String>> {
    // Descendants protégés (dossiers + fichiers, toute profondeur) d'un dossier.
    // Sert à bloquer la suppression d'un dossier non protégé contenant des protégés.
    let names = sqlx::query_scalar::<_, String>(
        r#"
        WITH RECURSIVE subtree AS (
            SELECT id, name, is_protected FROM drive.folders
            WHERE id = $1 AND owner_id = $2
            UNION ALL
            SELECT f.id, f.name, f.is_protected FROM drive.folders f
            INNER JOIN subtree s ON f.parent_id = s.id
            WHERE f.owner_id = $2
        )
        SELECT name FROM subtree WHERE is_protected = TRUE AND id <> $1
        UNION ALL
        SELECT fl.name FROM drive.files fl
        WHERE fl.owner_id = $2 AND fl.is_protected = TRUE
          AND fl.folder_id IN (SELECT id FROM subtree)
        "#,
    )
    .bind(folder_id)
    .bind(owner_id)
    .fetch_all(db)
    .await?;
    Ok(names)
}

// Construit le message d'erreur « suppression bloquée » listant les protégés.
fn protected_block_msg(folder_name: &str, names: &[String]) -> String {
    let preview = names.iter().take(6).cloned().collect::<Vec<_>>().join(", ");
    let more = if names.len() > 6 { format!(" (+{} autre·s)", names.len() - 6) } else { String::new() };
    format!(
        "Impossible de supprimer le dossier « {folder_name} » : il contient {} élément(s) protégé(s) par une application qui doivent rester en place : {preview}{more}. Déprotégez-les ou supprimez-les d'abord depuis l'application qui les gère.",
        names.len()
    )
}

// Active/désactive la protection d'un dossier (appelé par les modules via IPC).
pub async fn set_protected(db: &PgPool, owner_id: Uuid, folder_id: Uuid, protected: bool) -> Result<Folder> {
    sqlx::query_as::<_, Folder>(
        "UPDATE drive.folders SET is_protected = $3 WHERE id = $1 AND owner_id = $2 RETURNING *",
    )
    .bind(folder_id)
    .bind(owner_id)
    .bind(protected)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| FilesError::NotFound(format!("Dossier {folder_id} introuvable")))
}

pub async fn get_folder_ancestors(db: &PgPool, owner_id: Uuid, folder_id: Uuid) -> Result<Vec<FolderAncestor>> {
    let rows = sqlx::query_as::<_, FolderAncestor>(
        r#"WITH RECURSIVE anc AS (
               SELECT id, name, parent_id, 1 AS depth
               FROM drive.folders
               WHERE id = (SELECT parent_id FROM drive.folders WHERE id = $1 AND owner_id = $2)
                 AND owner_id = $2
               UNION ALL
               SELECT f.id, f.name, f.parent_id, anc.depth + 1
               FROM drive.folders f
               JOIN anc ON f.id = anc.parent_id
               WHERE f.owner_id = $2
           )
           SELECT id, name FROM anc ORDER BY depth DESC"#,
    )
    .bind(folder_id)
    .bind(owner_id)
    .fetch_all(db)
    .await?;
    Ok(rows)
}

pub async fn rename_folder(
    db: &PgPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    folder_id: Uuid,
    dto: RenameFolderDto,
) -> Result<Folder> {
    let name = dto.name.trim().to_string();
    validate_folder_name(&name)?;

    let old = get_folder(db, owner_id, folder_id).await?;

    if old.is_protected {
        return Err(FilesError::Forbidden);
    }

    // Chercher un dossier frère portant le nom demandé (sauf soi-même)
    let conflicting: Option<Folder> = if let Some(pid) = old.parent_id {
        sqlx::query_as::<_, Folder>(
            "SELECT * FROM drive.folders WHERE owner_id = $1 AND parent_id = $2 AND name = $3 AND id != $4"
        )
        .bind(owner_id).bind(pid).bind(&name).bind(folder_id)
        .fetch_optional(db).await?
    } else {
        sqlx::query_as::<_, Folder>(
            "SELECT * FROM drive.folders WHERE owner_id = $1 AND parent_id IS NULL AND name = $2 AND id != $3"
        )
        .bind(owner_id).bind(&name).bind(folder_id)
        .fetch_optional(db).await?
    };

    if let Some(target) = conflicting {
        if dto.overwrite {
            // Fusion : déplacer le contenu de folder_id dans target, puis supprimer folder_id
            let dst_parent = target.parent_id;
            let dst_id     = target.id;
            Box::pin(merge_into_folder(db, storage, owner_id, folder_id, dst_parent, dto.overwrite)).await?;
            return get_folder(db, owner_id, dst_id).await;
        } else if dto.strict {
            return Err(FilesError::Conflict(name));
        }
    }

    // Pas de conflit ou overwrite=false → déduplication par numérotation
    let sibling_names: Vec<String> = if let Some(pid) = old.parent_id {
        sqlx::query_scalar(
            "SELECT name FROM drive.folders WHERE owner_id = $1 AND parent_id = $2 AND id != $3"
        )
        .bind(owner_id).bind(pid).bind(folder_id)
        .fetch_all(db).await?
    } else {
        sqlx::query_scalar(
            "SELECT name FROM drive.folders WHERE owner_id = $1 AND parent_id IS NULL AND id != $2"
        )
        .bind(owner_id).bind(folder_id)
        .fetch_all(db).await?
    };
    let unique_name = unique_dir_name(&name, &sibling_names);

    // Nouveau chemin virtuel (remplace le dernier segment)
    let new_path = match old.path.rfind('/') {
        Some(pos) => format!("{}/{}", &old.path[..pos], unique_name),
        None      => format!("/{unique_name}"),
    };

    // Déplacer le répertoire physique
    let old_dir = storage_path::user_folder_dir(owner_id, &old.path);
    let new_dir = storage_path::user_folder_dir(owner_id, &new_path);
    storage.mv_dir(&old_dir.to_string_lossy(), &new_dir.to_string_lossy()).await?;

    let old_prefix     = &old.path;
    let old_prefix_len = old.path.len() as i32;

    // 1. Mettre à jour les chemins des dossiers descendants
    sqlx::query(
        "UPDATE drive.folders
         SET path = $1 || SUBSTR(path, $2 + 1)
         WHERE owner_id = $3 AND path LIKE $4"
    )
    .bind(&new_path)
    .bind(old_prefix_len)
    .bind(owner_id)
    .bind(format!("{old_prefix}/%"))
    .execute(db)
    .await?;

    // 2. Mettre à jour ce dossier lui-même
    let updated = sqlx::query_as::<_, Folder>(
        "UPDATE drive.folders SET name = $1, path = $2
         WHERE id = $3 AND owner_id = $4 RETURNING *"
    )
    .bind(&unique_name)
    .bind(&new_path)
    .bind(folder_id)
    .bind(owner_id)
    .fetch_one(db)
    .await?;

    // 3. Mettre à jour storage_path de tous les fichiers dans ce dossier et descendants
    //    (maintenant que les chemins de dossiers sont mis à jour)
    sqlx::query(
        "UPDATE drive.files AS fi
         SET storage_path = fi.owner_id::text || '/files' || f.path || '/' || fi.name
         FROM drive.folders AS f
         WHERE fi.folder_id = f.id
           AND fi.owner_id = $1
           AND f.owner_id  = $1
           AND (f.id = $2 OR f.path LIKE $3)"
    )
    .bind(owner_id)
    .bind(folder_id)
    .bind(format!("{new_path}/%"))
    .execute(db)
    .await?;

    Ok(updated)
}

pub async fn move_folder(
    db: &PgPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    folder_id: Uuid,
    dto: MoveFolderDto,
) -> Result<Folder> {
    let old = get_folder(db, owner_id, folder_id).await?;

    if old.is_protected {
        return Err(FilesError::Forbidden);
    }

    if dto.parent_id == Some(folder_id) {
        return Err(FilesError::Validation("Impossible de déplacer un dossier dans lui-même".into()));
    }

    // Chemin du nouveau parent
    let new_parent_path = if let Some(pid) = dto.parent_id {
        let parent = get_folder(db, owner_id, pid).await?;
        // Vérifier qu'on ne déplace pas dans un descendant
        if parent.path.starts_with(&format!("{}/", old.path)) || parent.path == old.path {
            return Err(FilesError::Validation(
                "Impossible de déplacer un dossier dans l'un de ses sous-dossiers".into()
            ));
        }
        parent.path
    } else {
        String::new()
    };

    // Chercher un dossier portant le même nom dans la destination
    let conflicting: Option<Folder> = if let Some(pid) = dto.parent_id {
        sqlx::query_as::<_, Folder>(
            "SELECT * FROM drive.folders WHERE owner_id = $1 AND parent_id = $2 AND name = $3 AND id != $4"
        )
        .bind(owner_id).bind(pid).bind(&old.name).bind(folder_id)
        .fetch_optional(db).await?
    } else {
        sqlx::query_as::<_, Folder>(
            "SELECT * FROM drive.folders WHERE owner_id = $1 AND parent_id IS NULL AND name = $2 AND id != $3"
        )
        .bind(owner_id).bind(&old.name).bind(folder_id)
        .fetch_optional(db).await?
    };

    if let Some(target) = conflicting {
        if dto.overwrite {
            // Fusion : déplacer tout le contenu de folder_id dans target
            let dst_id = target.id;
            Box::pin(merge_into_folder(db, storage, owner_id, folder_id, Some(dst_id), dto.overwrite)).await?;
            return get_folder(db, owner_id, dst_id).await;
        } else if dto.strict {
            return Err(FilesError::Conflict(old.name.clone()));
        }
    }

    // Pas de conflit ou overwrite=false → déduplication par numérotation
    let dest_sibling_names: Vec<String> = if let Some(pid) = dto.parent_id {
        sqlx::query_scalar(
            "SELECT name FROM drive.folders WHERE owner_id = $1 AND parent_id = $2 AND id != $3"
        )
        .bind(owner_id).bind(pid).bind(folder_id)
        .fetch_all(db).await?
    } else {
        sqlx::query_scalar(
            "SELECT name FROM drive.folders WHERE owner_id = $1 AND parent_id IS NULL AND id != $2"
        )
        .bind(owner_id).bind(folder_id)
        .fetch_all(db).await?
    };
    let unique_name = unique_dir_name(&old.name, &dest_sibling_names);

    let new_path = if new_parent_path.is_empty() {
        format!("/{unique_name}")
    } else {
        format!("{new_parent_path}/{unique_name}")
    };

    // Déplacer le répertoire physique
    let old_dir = storage_path::user_folder_dir(owner_id, &old.path);
    let new_dir = storage_path::user_folder_dir(owner_id, &new_path);
    storage.mv_dir(&old_dir.to_string_lossy(), &new_dir.to_string_lossy()).await?;

    let old_prefix     = &old.path;
    let old_prefix_len = old.path.len() as i32;

    // 1. Dossiers descendants
    sqlx::query(
        "UPDATE drive.folders
         SET path = $1 || SUBSTR(path, $2 + 1)
         WHERE owner_id = $3 AND path LIKE $4"
    )
    .bind(&new_path)
    .bind(old_prefix_len)
    .bind(owner_id)
    .bind(format!("{old_prefix}/%"))
    .execute(db)
    .await?;

    // 2. Ce dossier
    let updated = sqlx::query_as::<_, Folder>(
        "UPDATE drive.folders SET parent_id = $1, name = $2, path = $3
         WHERE id = $4 AND owner_id = $5 RETURNING *"
    )
    .bind(dto.parent_id)
    .bind(&unique_name)
    .bind(&new_path)
    .bind(folder_id)
    .bind(owner_id)
    .fetch_one(db)
    .await?;

    // 3. Storage paths des fichiers
    sqlx::query(
        "UPDATE drive.files AS fi
         SET storage_path = fi.owner_id::text || '/files' || f.path || '/' || fi.name
         FROM drive.folders AS f
         WHERE fi.folder_id = f.id
           AND fi.owner_id = $1
           AND f.owner_id  = $1
           AND (f.id = $2 OR f.path LIKE $3)"
    )
    .bind(owner_id)
    .bind(folder_id)
    .bind(format!("{new_path}/%"))
    .execute(db)
    .await?;

    Ok(updated)
}

pub async fn delete_folder(
    db: &PgPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    folder_id: Uuid,
) -> Result<()> {
    let folder = get_folder(db, owner_id, folder_id).await?;

    if folder.is_protected {
        return Err(FilesError::Forbidden);
    }

    let protected = protected_descendants(db, owner_id, folder_id).await?;
    if !protected.is_empty() {
        return Err(FilesError::Protected(protected_block_msg(&folder.name, &protected)));
    }

    let result = sqlx::query(
        "DELETE FROM drive.folders WHERE id = $1 AND owner_id = $2"
    )
    .bind(folder_id)
    .bind(owner_id)
    .execute(db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(FilesError::NotFound(format!("Dossier {folder_id} introuvable")));
    }

    // Supprimer le répertoire physique (et tout son contenu)
    let dir = storage_path::user_folder_dir(owner_id, &folder.path);
    if let Err(e) = storage.delete_dir(&dir.to_string_lossy()).await {
        tracing::warn!(path = %dir.display(), error = %e, "Could not delete folder directory on disk");
    }

    Ok(())
}

pub async fn toggle_star_folder(
    db: &PgPool,
    owner_id: Uuid,
    folder_id: Uuid,
) -> Result<Folder> {
    sqlx::query_as::<_, Folder>(
        "UPDATE drive.folders SET is_starred = NOT is_starred
         WHERE id = $1 AND owner_id = $2 RETURNING *"
    )
    .bind(folder_id)
    .bind(owner_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| FilesError::NotFound(format!("Dossier {folder_id} introuvable")))
}

pub async fn set_folder_color(
    db: &PgPool,
    owner_id: Uuid,
    folder_id: Uuid,
    dto: SetFolderColorDto,
) -> Result<Folder> {
    sqlx::query_as::<_, Folder>(
        "UPDATE drive.folders SET color = $1
         WHERE id = $2 AND owner_id = $3 RETURNING *"
    )
    .bind(dto.color.as_deref())
    .bind(folder_id)
    .bind(owner_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| FilesError::NotFound(format!("Dossier {folder_id} introuvable")))
}

/// Crée (ou retrouve) toute la hiérarchie de dossiers pour un chemin donné.
/// Ex: "Office/Documents" crée /Office puis /Office/Documents si absents.
/// Si `protect` est true, tous les dossiers du chemin sont marqués `is_protected = TRUE`.
/// Retourne le dossier final (le plus profond dans le chemin).
pub async fn ensure_path(
    db:       &PgPool,
    storage:  &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    path:     &str,
    protect:  bool,
    hidden:   bool,
    icon:     Option<&str>,
) -> Result<Folder> {
    let segments: Vec<&str> = path.trim_matches('/').split('/').filter(|s| !s.is_empty()).collect();

    if segments.is_empty() {
        return Err(FilesError::Validation("Chemin de dossier vide".into()));
    }

    let seg_count = segments.len();
    let mut parent_id: Option<Uuid> = None;
    let mut last_folder: Option<Folder> = None;

    for (idx, segment) in segments.into_iter().enumerate() {
        let is_leaf = idx + 1 == seg_count;
        let existing: Option<Folder> = if let Some(pid) = parent_id {
            sqlx::query_as::<_, Folder>(
                "SELECT * FROM drive.folders WHERE owner_id = $1 AND parent_id = $2 AND name = $3"
            )
            .bind(owner_id)
            .bind(pid)
            .bind(segment)
            .fetch_optional(db)
            .await?
        } else {
            sqlx::query_as::<_, Folder>(
                "SELECT * FROM drive.folders WHERE owner_id = $1 AND parent_id IS NULL AND name = $2"
            )
            .bind(owner_id)
            .bind(segment)
            .fetch_optional(db)
            .await?
        };

        // On ne cache QUE les segments dont le nom commence par '.' (ex. ".media"),
        // afin que les dossiers parents visibles (ex. "Office") restent affichés.
        let seg_hidden = hidden && segment.starts_with('.');

        let mut folder = if let Some(f) = existing {
            if (protect && !f.is_protected) || (seg_hidden && !f.is_hidden) {
                sqlx::query_as::<_, Folder>(
                    "UPDATE drive.folders
                     SET is_protected = is_protected OR $2, is_hidden = is_hidden OR $3
                     WHERE id = $1 RETURNING *"
                )
                .bind(f.id)
                .bind(protect)
                .bind(seg_hidden)
                .fetch_one(db)
                .await?
            } else {
                f
            }
        } else {
            let created = create_folder(
                db, storage, owner_id,
                CreateFolderDto { name: segment.to_string(), parent_id },
            ).await?;
            if protect || seg_hidden {
                sqlx::query_as::<_, Folder>(
                    "UPDATE drive.folders
                     SET is_protected = is_protected OR $2, is_hidden = is_hidden OR $3
                     WHERE id = $1 RETURNING *"
                )
                .bind(created.id)
                .bind(protect)
                .bind(seg_hidden)
                .fetch_one(db)
                .await?
            } else {
                created
            }
        };

        // Icône du dossier feuille (dossier de module/sous-module). Posée si fournie
        // et différente de l'existante.
        if is_leaf {
            if let Some(ic) = icon {
                if folder.icon.as_deref() != Some(ic) {
                    folder = sqlx::query_as::<_, Folder>(
                        "UPDATE drive.folders SET icon = $2 WHERE id = $1 RETURNING *"
                    )
                    .bind(folder.id)
                    .bind(ic)
                    .fetch_one(db)
                    .await?;
                }
            }
        }

        parent_id = Some(folder.id);
        last_folder = Some(folder);
    }

    last_folder.ok_or_else(|| FilesError::Validation("Chemin invalide".into()))
}

/// Fusionne récursivement le contenu du dossier `src_id` dans le dossier `dst_id`.
/// - Les fichiers du src sont déplacés dans dst (avec la politique `overwrite` pour les conflits).
/// - Les sous-dossiers sont traités récursivement (merge si un dossier portant le même nom existe).
/// - Le dossier src est supprimé une fois vide.
pub async fn merge_into_folder(
    db:       &PgPool,
    storage:  &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    src_id:   Uuid,
    dst_id:   Option<Uuid>,
    overwrite: bool,
) -> Result<()> {
    // 1. Déplacer tous les fichiers du src vers dst
    let src_files: Vec<crate::models::File> = sqlx::query_as::<_, crate::models::File>(
        "SELECT * FROM drive.files WHERE owner_id = $1 AND folder_id = $2 AND is_trashed = FALSE"
    )
    .bind(owner_id)
    .bind(src_id)
    .fetch_all(db)
    .await?;

    for f in src_files {
        files::move_file(db, storage, owner_id, f.id, MoveFileDto { folder_id: dst_id, overwrite, strict: false }).await?;
    }

    // 2. Déplacer / fusionner récursivement tous les sous-dossiers du src
    let src_sub: Vec<Folder> = sqlx::query_as::<_, Folder>(
        "SELECT * FROM drive.folders WHERE owner_id = $1 AND parent_id = $2"
    )
    .bind(owner_id)
    .bind(src_id)
    .fetch_all(db)
    .await?;

    for sub in src_sub {
        // Box::pin évite la future récursive de taille infinie (move_folder ↔ merge_into_folder)
        Box::pin(move_folder(db, storage, owner_id, sub.id, MoveFolderDto { parent_id: dst_id, overwrite, strict: false })).await?;
    }

    // 3. Supprimer le dossier source maintenant vide
    delete_folder(db, storage, owner_id, src_id).await?;

    Ok(())
}

fn validate_folder_name(name: &str) -> Result<()> {
    if name.is_empty() || name.len() > 255 {
        return Err(FilesError::Validation("Nom de dossier invalide".into()));
    }
    if name.contains('/') || name == ".." || name == "." {
        return Err(FilesError::Validation(
            "Le nom de dossier ne peut pas contenir '/', '..' ou '.'".into()
        ));
    }
    Ok(())
}

// ── Corbeille — vidage ────────────────────────────────────────────────────────

pub struct PurgeTrashResult {
    pub folders_deleted: u64,
    pub files_deleted:   u64,
}

/// Supprime définitivement tous les éléments corbeillés d'un utilisateur.
///
/// Ordre d'opérations :
/// 1. Supprimer le stockage physique de tous les fichiers dans les sous-arbres corbeillés
/// 2. Supprimer du stockage les fichiers individuellement corbeillés
/// 3. Supprimer de la DB les fichiers dans les sous-arbres corbeillés
/// 4. Supprimer de la DB les fichiers individuellement corbeillés
/// 5. Supprimer du stockage les répertoires des dossiers corbeillés
/// 6. Supprimer de la DB les dossiers corbeillés (CASCADE sur les sous-dossiers)
pub async fn purge_trash(
    db:       &PgPool,
    storage:  &Arc<dyn StorageBackend>,
    owner_id: Uuid,
) -> Result<PurgeTrashResult> {
    // ── Étape 1 & 2 : collecte des chemins de fichiers à supprimer du storage ──

    // Fichiers dans les sous-arbres des dossiers corbeillés
    let subtree_paths: Vec<String> = sqlx::query_scalar(
        r#"WITH RECURSIVE trashed_tree AS (
               SELECT id FROM drive.folders
               WHERE owner_id = $1 AND is_trashed = TRUE
               UNION ALL
               SELECT f.id FROM drive.folders f
               INNER JOIN trashed_tree t ON f.parent_id = t.id
               WHERE f.owner_id = $1
           )
           SELECT storage_path FROM drive.files
           WHERE owner_id = $1 AND folder_id IN (SELECT id FROM trashed_tree)"#,
    )
    .bind(owner_id)
    .fetch_all(db)
    .await?;

    // Fichiers individuellement corbeillés (hors sous-arbre)
    let individual_paths: Vec<String> = sqlx::query_scalar(
        "SELECT storage_path FROM drive.files WHERE owner_id = $1 AND is_trashed = TRUE",
    )
    .bind(owner_id)
    .fetch_all(db)
    .await?;

    for path in subtree_paths.iter().chain(individual_paths.iter()) {
        if let Err(e) = storage.delete(path).await {
            tracing::warn!(path, error = %e, "purge_trash: impossible de supprimer le fichier");
        }
    }

    // ── Étape 3 : supprimer les fichiers dans les sous-arbres corbeillés ──────

    sqlx::query(
        r#"WITH RECURSIVE trashed_tree AS (
               SELECT id FROM drive.folders
               WHERE owner_id = $1 AND is_trashed = TRUE
               UNION ALL
               SELECT f.id FROM drive.folders f
               INNER JOIN trashed_tree t ON f.parent_id = t.id
               WHERE f.owner_id = $1
           )
           DELETE FROM drive.files
           WHERE owner_id = $1 AND folder_id IN (SELECT id FROM trashed_tree)"#,
    )
    .bind(owner_id)
    .execute(db)
    .await?;

    // ── Étape 4 : supprimer les fichiers individuellement corbeillés ──────────

    let files_deleted = sqlx::query(
        "DELETE FROM drive.files WHERE owner_id = $1 AND is_trashed = TRUE",
    )
    .bind(owner_id)
    .execute(db)
    .await?
    .rows_affected();

    // ── Étape 5 : supprimer les répertoires physiques ─────────────────────────

    let trashed_folder_paths: Vec<String> = sqlx::query_scalar(
        "SELECT path FROM drive.folders WHERE owner_id = $1 AND is_trashed = TRUE",
    )
    .bind(owner_id)
    .fetch_all(db)
    .await?;

    for path in &trashed_folder_paths {
        let dir = storage_path::user_folder_dir(owner_id, path);
        if let Err(e) = storage.delete_dir(&dir.to_string_lossy()).await {
            tracing::warn!(path, error = %e, "purge_trash: impossible de supprimer le répertoire");
        }
    }

    // ── Étape 6 : supprimer les dossiers corbeillés (CASCADE sur les enfants) ─

    let folders_deleted = sqlx::query(
        "DELETE FROM drive.folders WHERE owner_id = $1 AND is_trashed = TRUE",
    )
    .bind(owner_id)
    .execute(db)
    .await?
    .rows_affected();

    Ok(PurgeTrashResult { folders_deleted, files_deleted })
}
