use kubuno_db::{params, DbPool, DbQueryBuilder, DbValue};
use kubuno_storage::{path as storage_path, unique_dir_name, StorageBackend};
use std::sync::Arc;
use uuid::Uuid;

use crate::sync;
use crate::{
    errors::{FilesError, Result},
    models::{
        CreateFolderDto, Folder, FolderAncestor, FolderSize, MoveFileDto, MoveFolderDto,
        RenameFolderDto, SetFolderColorDto,
    },
    services::files,
};

// ── Small row projections ─────────────────────────────────────────────────────
#[derive(sqlx::FromRow)]
struct NameRow {
    name: String,
}
#[derive(sqlx::FromRow)]
struct IdPath {
    id: Uuid,
    path: String,
}
#[derive(sqlx::FromRow)]
struct FileFolder {
    file_id: Uuid,
    file_name: String,
    folder_path: String,
}
#[derive(sqlx::FromRow)]
struct IdOnly {
    id: Uuid,
}

// ── Journal helpers ───────────────────────────────────────────────────────────

/// Inserts a `drive.folders` row with a fresh `change_seq` and a caller-minted
/// id (no `RETURNING`/`gen_random_uuid()` on MySQL).
async fn insert_folder(
    db: &DbPool,
    id: Uuid,
    owner_id: Uuid,
    parent_id: Option<Uuid>,
    name: &str,
    path: &str,
) -> Result<Folder> {
    let mut tx = db.begin().await?;
    let seq = sync::next_seq(&mut tx).await?;
    tx.execute(
        "INSERT INTO drive.folders (id, owner_id, parent_id, name, path, change_seq)
         VALUES ($1, $2, $3, $4, $5, $6)",
        params![id, owner_id, parent_id, name, path, seq],
    )
    .await?;
    tx.commit().await?;
    get_folder(db, owner_id, id).await
}

/// Guarded `UPDATE` on `drive.folders` that also stamps a fresh `change_seq`,
/// then returns the updated folder. Because the seq always changes, a matched
/// row genuinely changes, so `rows_affected == 0` means "no such owned row" on
/// every engine (MySQL reports 0 for a no-op update; the fresh seq avoids that).
async fn update_folder_returning(
    db: &DbPool,
    owner_id: Uuid,
    folder_id: Uuid,
    set_sql: &str,
    mut ps: Vec<DbValue>,
) -> Result<Folder> {
    let mut tx = db.begin().await?;
    let seq = sync::next_seq(&mut tx).await?;
    let n = ps.len();
    let sql = format!(
        "UPDATE drive.folders SET {set_sql}, change_seq = ${} WHERE id = ${} AND owner_id = ${}",
        n + 1,
        n + 2,
        n + 3
    );
    ps.push(DbValue::from(seq));
    ps.push(DbValue::from(folder_id));
    ps.push(DbValue::from(owner_id));
    let affected = tx.execute(&sql, ps).await?;
    if affected == 0 {
        tx.rollback().await?;
        return Err(FilesError::NotFound(format!("Dossier {folder_id} introuvable")));
    }
    tx.commit().await?;
    get_folder(db, owner_id, folder_id).await
}

pub async fn create_folder(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    dto: CreateFolderDto,
) -> Result<Folder> {
    let base_name = dto.name.trim().to_string();
    validate_folder_name(&base_name)?;

    let parent_path = if let Some(parent_id) = dto.parent_id {
        let parent = db
            .fetch_optional_as::<Folder>(
                "SELECT * FROM drive.folders WHERE id = $1 AND owner_id = $2",
                params![parent_id, owner_id],
            )
            .await?
            .ok_or_else(|| FilesError::NotFound("Dossier parent introuvable".into()))?;
        parent.path.trim_end_matches('/').to_string()
    } else {
        String::new()
    };

    // Éviter les collisions de noms dans le même parent.
    let existing_names: Vec<String> = if let Some(pid) = dto.parent_id {
        db.fetch_all_as::<NameRow>(
            "SELECT name FROM drive.folders WHERE owner_id = $1 AND parent_id = $2",
            params![owner_id, pid],
        )
        .await?
    } else {
        db.fetch_all_as::<NameRow>(
            "SELECT name FROM drive.folders WHERE owner_id = $1 AND parent_id IS NULL",
            params![owner_id],
        )
        .await?
    }
    .into_iter()
    .map(|r| r.name)
    .collect();

    let name = unique_dir_name(&base_name, &existing_names);
    let path = if parent_path.is_empty() { format!("/{name}") } else { format!("{parent_path}/{name}") };

    // Honour a client-supplied id (offline create from drive-core) verbatim, else
    // mint one here (MySQL has no gen_random_uuid()/RETURNING).
    let id = dto.id.unwrap_or_else(kubuno_db::new_id);
    let folder = insert_folder(db, id, owner_id, dto.parent_id, &name, &path).await?;

    let dir = storage_path::user_folder_dir(owner_id, &folder.path);
    if let Err(e) = storage.create_dir(&dir.to_string_lossy()).await {
        tracing::warn!(path = %dir.display(), error = %e, "Could not create folder directory");
    }

    Ok(folder)
}

pub async fn list_folders(
    db: &DbPool,
    owner_id: Uuid,
    parent_id: Option<Uuid>,
    trashed: bool,
) -> Result<Vec<Folder>> {
    let folders = if trashed {
        db.fetch_all_as::<Folder>(
            "SELECT * FROM drive.folders
             WHERE owner_id = $1 AND is_trashed = TRUE
             ORDER BY name ASC",
            params![owner_id],
        )
        .await?
    } else if let Some(pid) = parent_id {
        db.fetch_all_as::<Folder>(
            "SELECT * FROM drive.folders
             WHERE owner_id = $1 AND parent_id = $2 AND is_trashed = FALSE AND is_hidden = FALSE
             ORDER BY name ASC",
            params![owner_id, pid],
        )
        .await?
    } else {
        db.fetch_all_as::<Folder>(
            "SELECT * FROM drive.folders
             WHERE owner_id = $1 AND parent_id IS NULL AND is_trashed = FALSE AND is_hidden = FALSE
             ORDER BY name ASC",
            params![owner_id],
        )
        .await?
    };
    Ok(folders)
}

/// Liste les dossiers triés par taille récursive décroissante (dossier + descendants).
pub async fn list_folders_by_size(db: &DbPool, owner_id: Uuid, limit: i64) -> Result<Vec<FolderSize>> {
    let b = db.backend();
    // A descendant d of f: same path, or path starting with `f.path` + '/'. The
    // prefix test avoids `left()`/`||` (neither is portable) with SUBSTR/length.
    let sql = format!(
        r#"SELECT f.id, f.name, f.path,
                  {total} AS total_size,
                  {count} AS file_count
           FROM drive.folders f
           LEFT JOIN drive.folders d
             ON d.owner_id = f.owner_id
            AND d.is_trashed = FALSE
            AND (d.path = f.path
                 OR (SUBSTR(d.path, 1, length(f.path)) = f.path
                     AND SUBSTR(d.path, length(f.path) + 1, 1) = '/'))
           LEFT JOIN drive.files fl
             ON fl.folder_id = d.id AND fl.is_trashed = FALSE
           WHERE f.owner_id = $1 AND f.is_trashed = FALSE
           GROUP BY f.id, f.name, f.path
           ORDER BY total_size DESC, f.name ASC
           LIMIT $2"#,
        total = b.sum_bigint("fl.size_bytes"),
        count = b.count_bigint("fl.id"),
    );
    let rows = db
        .fetch_all_as::<FolderSize>(&sql, params![owner_id, limit.clamp(1, 1000)])
        .await?;
    Ok(rows)
}

pub async fn trash_folder(db: &DbPool, owner_id: Uuid, folder_id: Uuid) -> Result<Folder> {
    let folder = get_folder(db, owner_id, folder_id).await?;
    if folder.is_protected {
        return Err(FilesError::Forbidden);
    }
    let protected = protected_descendants(db, owner_id, folder_id).await?;
    if !protected.is_empty() {
        return Err(FilesError::Protected(protected_block_msg(&folder.name, &protected)));
    }
    update_folder_returning(
        db,
        owner_id,
        folder_id,
        "is_trashed = $1, trashed_at = $2",
        params![true, chrono::Utc::now()],
    )
    .await
}

pub async fn restore_folder(db: &DbPool, owner_id: Uuid, folder_id: Uuid) -> Result<Folder> {
    update_folder_returning(
        db,
        owner_id,
        folder_id,
        "is_trashed = $1, trashed_at = $2",
        params![false, None::<chrono::DateTime<chrono::Utc>>],
    )
    .await
}

pub async fn get_folder(db: &DbPool, owner_id: Uuid, folder_id: Uuid) -> Result<Folder> {
    db.fetch_optional_as::<Folder>(
        "SELECT * FROM drive.folders WHERE id = $1 AND owner_id = $2",
        params![folder_id, owner_id],
    )
    .await?
    .ok_or_else(|| FilesError::NotFound(format!("Dossier {folder_id} introuvable")))
}

/// Descendants protégés (dossiers + fichiers, toute profondeur) d'un dossier.
pub async fn protected_descendants(db: &DbPool, owner_id: Uuid, folder_id: Uuid) -> Result<Vec<String>> {
    // Every value is bound once (a placeholder may not be reused): folder_id
    // twice, owner_id three times.
    let names = db
        .fetch_all_as::<NameRow>(
            r#"
            WITH RECURSIVE subtree AS (
                SELECT id, name, is_protected FROM drive.folders
                WHERE id = $1 AND owner_id = $2
                UNION ALL
                SELECT f.id, f.name, f.is_protected FROM drive.folders f
                INNER JOIN subtree s ON f.parent_id = s.id
                WHERE f.owner_id = $3
            )
            SELECT name FROM subtree WHERE is_protected = TRUE AND id <> $4
            UNION ALL
            SELECT fl.name FROM drive.files fl
            WHERE fl.owner_id = $5 AND fl.is_protected = TRUE
              AND fl.folder_id IN (SELECT id FROM subtree)
            "#,
            params![folder_id, owner_id, owner_id, folder_id, owner_id],
        )
        .await?
        .into_iter()
        .map(|r| r.name)
        .collect();
    Ok(names)
}

fn protected_block_msg(folder_name: &str, names: &[String]) -> String {
    let preview = names.iter().take(6).cloned().collect::<Vec<_>>().join(", ");
    let more = if names.len() > 6 { format!(" (+{} autre·s)", names.len() - 6) } else { String::new() };
    format!(
        "Impossible de supprimer le dossier « {folder_name} » : il contient {} élément(s) protégé(s) par une application qui doivent rester en place : {preview}{more}. Déprotégez-les ou supprimez-les d'abord depuis l'application qui les gère.",
        names.len()
    )
}

// Active/désactive la protection d'un dossier (appelé par les modules via IPC).
pub async fn set_protected(db: &DbPool, owner_id: Uuid, folder_id: Uuid, protected: bool) -> Result<Folder> {
    update_folder_returning(db, owner_id, folder_id, "is_protected = $1", params![protected]).await
}

pub async fn get_folder_ancestors(db: &DbPool, owner_id: Uuid, folder_id: Uuid) -> Result<Vec<FolderAncestor>> {
    // $1 folder_id; $2..$4 owner_id (bound three times).
    let rows = db
        .fetch_all_as::<FolderAncestor>(
            r#"WITH RECURSIVE anc AS (
                   SELECT id, name, parent_id, 1 AS depth
                   FROM drive.folders
                   WHERE id = (SELECT parent_id FROM drive.folders WHERE id = $1 AND owner_id = $2)
                     AND owner_id = $3
                   UNION ALL
                   SELECT f.id, f.name, f.parent_id, anc.depth + 1
                   FROM drive.folders f
                   JOIN anc ON f.id = anc.parent_id
                   WHERE f.owner_id = $4
               )
               SELECT id, name FROM anc ORDER BY depth DESC"#,
            params![folder_id, owner_id, owner_id, owner_id],
        )
        .await?;
    Ok(rows)
}

/// Rewrites the paths of every descendant folder of a moved/renamed folder, each
/// stamped with a fresh `change_seq`. `old_path`/`new_path` are the moved
/// folder's own paths; descendants share the `old_path/` prefix.
async fn rewrite_descendant_paths(db: &DbPool, owner_id: Uuid, old_path: &str, new_path: &str) -> Result<()> {
    let like = format!("{old_path}/%");
    let descendants: Vec<IdPath> = db
        .fetch_all_as::<IdPath>(
            "SELECT id, path FROM drive.folders WHERE owner_id = $1 AND path LIKE $2",
            params![owner_id, like],
        )
        .await?;
    if descendants.is_empty() {
        return Ok(());
    }
    let mut tx = db.begin().await?;
    for d in &descendants {
        let suffix = &d.path[old_path.len()..]; // keeps the leading '/'
        let np = format!("{new_path}{suffix}");
        let seq = sync::next_seq(&mut tx).await?;
        tx.execute(
            "UPDATE drive.folders SET path = $1, change_seq = $2 WHERE id = $3",
            params![np, seq, d.id],
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Recomputes `storage_path` for every file under a folder that just moved (the
/// folder itself and all its descendants, whose paths are already final),
/// stamping each with a fresh `change_seq`. Portable replacement for the old
/// `UPDATE ... FROM` with `owner_id::text || ...` (no cross-engine UUID→text).
async fn rewrite_files_storage(db: &DbPool, owner_id: Uuid, folder_id: Uuid, new_path: &str) -> Result<()> {
    let like = format!("{new_path}/%");
    let rows: Vec<FileFolder> = db
        .fetch_all_as::<FileFolder>(
            "SELECT fi.id AS file_id, fi.name AS file_name, f.path AS folder_path
             FROM drive.files fi JOIN drive.folders f ON fi.folder_id = f.id
             WHERE fi.owner_id = $1 AND f.owner_id = $2 AND (f.id = $3 OR f.path LIKE $4)",
            params![owner_id, owner_id, folder_id, like],
        )
        .await?;
    if rows.is_empty() {
        return Ok(());
    }
    let mut tx = db.begin().await?;
    for r in &rows {
        let sp = storage_path::user_file_path(owner_id, &r.folder_path, &r.file_name)
            .to_string_lossy()
            .to_string();
        let seq = sync::next_seq(&mut tx).await?;
        tx.execute(
            "UPDATE drive.files SET storage_path = $1, change_seq = $2 WHERE id = $3",
            params![sp, seq, r.file_id],
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn rename_folder(
    db: &DbPool,
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

    // Sibling with the requested name (excluding self).
    let conflicting: Option<Folder> = if let Some(pid) = old.parent_id {
        db.fetch_optional_as::<Folder>(
            "SELECT * FROM drive.folders WHERE owner_id = $1 AND parent_id = $2 AND name = $3 AND id != $4",
            params![owner_id, pid, &name, folder_id],
        )
        .await?
    } else {
        db.fetch_optional_as::<Folder>(
            "SELECT * FROM drive.folders WHERE owner_id = $1 AND parent_id IS NULL AND name = $2 AND id != $3",
            params![owner_id, &name, folder_id],
        )
        .await?
    };

    if let Some(target) = conflicting {
        if dto.overwrite {
            let dst_parent = target.parent_id;
            let dst_id = target.id;
            Box::pin(merge_into_folder(db, storage, owner_id, folder_id, dst_parent, dto.overwrite)).await?;
            return get_folder(db, owner_id, dst_id).await;
        } else if dto.strict {
            return Err(FilesError::Conflict(name));
        }
    }

    let sibling_names: Vec<String> = if let Some(pid) = old.parent_id {
        db.fetch_all_as::<NameRow>(
            "SELECT name FROM drive.folders WHERE owner_id = $1 AND parent_id = $2 AND id != $3",
            params![owner_id, pid, folder_id],
        )
        .await?
    } else {
        db.fetch_all_as::<NameRow>(
            "SELECT name FROM drive.folders WHERE owner_id = $1 AND parent_id IS NULL AND id != $2",
            params![owner_id, folder_id],
        )
        .await?
    }
    .into_iter()
    .map(|r| r.name)
    .collect();
    let unique_name = unique_dir_name(&name, &sibling_names);

    let new_path = match old.path.rfind('/') {
        Some(pos) => format!("{}/{}", &old.path[..pos], unique_name),
        None => format!("/{unique_name}"),
    };

    let old_dir = storage_path::user_folder_dir(owner_id, &old.path);
    let new_dir = storage_path::user_folder_dir(owner_id, &new_path);
    storage.mv_dir(&old_dir.to_string_lossy(), &new_dir.to_string_lossy()).await?;

    // 1. Descendant folder paths, 2. this folder, 3. every file's storage_path.
    rewrite_descendant_paths(db, owner_id, &old.path, &new_path).await?;
    let updated = update_folder_returning(
        db,
        owner_id,
        folder_id,
        "name = $1, path = $2",
        params![&unique_name, &new_path],
    )
    .await?;
    rewrite_files_storage(db, owner_id, folder_id, &new_path).await?;

    Ok(updated)
}

pub async fn move_folder(
    db: &DbPool,
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

    let new_parent_path = if let Some(pid) = dto.parent_id {
        let parent = get_folder(db, owner_id, pid).await?;
        if parent.path.starts_with(&format!("{}/", old.path)) || parent.path == old.path {
            return Err(FilesError::Validation(
                "Impossible de déplacer un dossier dans l'un de ses sous-dossiers".into(),
            ));
        }
        parent.path
    } else {
        String::new()
    };

    let conflicting: Option<Folder> = if let Some(pid) = dto.parent_id {
        db.fetch_optional_as::<Folder>(
            "SELECT * FROM drive.folders WHERE owner_id = $1 AND parent_id = $2 AND name = $3 AND id != $4",
            params![owner_id, pid, &old.name, folder_id],
        )
        .await?
    } else {
        db.fetch_optional_as::<Folder>(
            "SELECT * FROM drive.folders WHERE owner_id = $1 AND parent_id IS NULL AND name = $2 AND id != $3",
            params![owner_id, &old.name, folder_id],
        )
        .await?
    };

    if let Some(target) = conflicting {
        if dto.overwrite {
            let dst_id = target.id;
            Box::pin(merge_into_folder(db, storage, owner_id, folder_id, Some(dst_id), dto.overwrite)).await?;
            return get_folder(db, owner_id, dst_id).await;
        } else if dto.strict {
            return Err(FilesError::Conflict(old.name.clone()));
        }
    }

    let dest_sibling_names: Vec<String> = if let Some(pid) = dto.parent_id {
        db.fetch_all_as::<NameRow>(
            "SELECT name FROM drive.folders WHERE owner_id = $1 AND parent_id = $2 AND id != $3",
            params![owner_id, pid, folder_id],
        )
        .await?
    } else {
        db.fetch_all_as::<NameRow>(
            "SELECT name FROM drive.folders WHERE owner_id = $1 AND parent_id IS NULL AND id != $2",
            params![owner_id, folder_id],
        )
        .await?
    }
    .into_iter()
    .map(|r| r.name)
    .collect();
    let unique_name = unique_dir_name(&old.name, &dest_sibling_names);

    let new_path = if new_parent_path.is_empty() {
        format!("/{unique_name}")
    } else {
        format!("{new_parent_path}/{unique_name}")
    };

    let old_dir = storage_path::user_folder_dir(owner_id, &old.path);
    let new_dir = storage_path::user_folder_dir(owner_id, &new_path);
    storage.mv_dir(&old_dir.to_string_lossy(), &new_dir.to_string_lossy()).await?;

    rewrite_descendant_paths(db, owner_id, &old.path, &new_path).await?;
    let updated = update_folder_returning(
        db,
        owner_id,
        folder_id,
        "parent_id = $1, name = $2, path = $3",
        params![dto.parent_id, &unique_name, &new_path],
    )
    .await?;
    rewrite_files_storage(db, owner_id, folder_id, &new_path).await?;

    Ok(updated)
}

pub async fn delete_folder(
    db: &DbPool,
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

    // Enumerate the whole subtree BEFORE deleting: descendant folders (cascade
    // would drop them silently, so we tombstone each explicitly), and the files
    // under them (which the FK sets to NULL — orphaned to root — so we bump their
    // change_seq explicitly to surface the move in the delta feed).
    let subtree: Vec<IdPath> = db
        .fetch_all_as::<IdPath>(
            r#"WITH RECURSIVE sub AS (
                   SELECT id, path FROM drive.folders WHERE id = $1 AND owner_id = $2
                   UNION ALL
                   SELECT f.id, f.path FROM drive.folders f
                   INNER JOIN sub s ON f.parent_id = s.id
                   WHERE f.owner_id = $3
               )
               SELECT id, path FROM sub"#,
            params![folder_id, owner_id, owner_id],
        )
        .await?;
    let subtree_ids: Vec<Uuid> = subtree.iter().map(|f| f.id).collect();

    let mut qb = DbQueryBuilder::new(db.backend(), "SELECT id FROM drive.files WHERE owner_id = ");
    qb.push_bind(owner_id).push(" AND folder_id").push_in(subtree_ids.iter().copied());
    let orphan_files: Vec<Uuid> = qb.fetch_all_as::<IdOnly>(db).await?.into_iter().map(|r| r.id).collect();

    let mut tx = db.begin().await?;
    // Orphan the files first (folder_id NULL) so the later cascade is a no-op.
    for fid in &orphan_files {
        let seq = sync::next_seq(&mut tx).await?;
        tx.execute(
            "UPDATE drive.files SET folder_id = NULL, change_seq = $1 WHERE id = $2",
            params![seq, fid],
        )
        .await?;
    }
    // Delete the root folder; the FK cascade removes descendant folders.
    let affected = tx
        .execute(
            "DELETE FROM drive.folders WHERE id = $1 AND owner_id = $2",
            params![folder_id, owner_id],
        )
        .await?;
    if affected == 0 {
        tx.rollback().await?;
        return Err(FilesError::NotFound(format!("Dossier {folder_id} introuvable")));
    }
    // Tombstone every folder that was deleted (root + descendants).
    for f in &subtree {
        let seq = sync::next_seq(&mut tx).await?;
        sync::record_folder_tombstone(&mut tx, f.id, owner_id, &f.path, seq).await?;
    }
    tx.commit().await?;

    let dir = storage_path::user_folder_dir(owner_id, &folder.path);
    if let Err(e) = storage.delete_dir(&dir.to_string_lossy()).await {
        tracing::warn!(path = %dir.display(), error = %e, "Could not delete folder directory on disk");
    }

    Ok(())
}

pub async fn toggle_star_folder(db: &DbPool, owner_id: Uuid, folder_id: Uuid) -> Result<Folder> {
    update_folder_returning(db, owner_id, folder_id, "is_starred = NOT is_starred", params![]).await
}

pub async fn set_folder_color(
    db: &DbPool,
    owner_id: Uuid,
    folder_id: Uuid,
    dto: SetFolderColorDto,
) -> Result<Folder> {
    update_folder_returning(db, owner_id, folder_id, "color = $1", params![dto.color.as_deref()]).await
}

/// Crée (ou retrouve) toute la hiérarchie de dossiers pour un chemin donné.
pub async fn ensure_path(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    path: &str,
    protect: bool,
    hidden: bool,
    icon: Option<&str>,
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
            db.fetch_optional_as::<Folder>(
                "SELECT * FROM drive.folders WHERE owner_id = $1 AND parent_id = $2 AND name = $3",
                params![owner_id, pid, segment],
            )
            .await?
        } else {
            db.fetch_optional_as::<Folder>(
                "SELECT * FROM drive.folders WHERE owner_id = $1 AND parent_id IS NULL AND name = $2",
                params![owner_id, segment],
            )
            .await?
        };

        // Only segments whose name starts with '.' are hidden (so visible parents stay shown).
        let seg_hidden = hidden && segment.starts_with('.');

        let mut folder = if let Some(f) = existing {
            if (protect && !f.is_protected) || (seg_hidden && !f.is_hidden) {
                update_folder_returning(
                    db,
                    owner_id,
                    f.id,
                    "is_protected = is_protected OR $1, is_hidden = is_hidden OR $2",
                    params![protect, seg_hidden],
                )
                .await?
            } else {
                f
            }
        } else {
            let created = create_folder(
                db,
                storage,
                owner_id,
                CreateFolderDto { name: segment.to_string(), parent_id, id: None },
            )
            .await?;
            if protect || seg_hidden {
                update_folder_returning(
                    db,
                    owner_id,
                    created.id,
                    "is_protected = is_protected OR $1, is_hidden = is_hidden OR $2",
                    params![protect, seg_hidden],
                )
                .await?
            } else {
                created
            }
        };

        if is_leaf {
            if let Some(ic) = icon {
                if folder.icon.as_deref() != Some(ic) {
                    folder = update_folder_returning(db, owner_id, folder.id, "icon = $1", params![ic]).await?;
                }
            }
        }

        parent_id = Some(folder.id);
        last_folder = Some(folder);
    }

    last_folder.ok_or_else(|| FilesError::Validation("Chemin invalide".into()))
}

/// Fusionne récursivement le contenu du dossier `src_id` dans le dossier `dst_id`.
pub async fn merge_into_folder(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    src_id: Uuid,
    dst_id: Option<Uuid>,
    overwrite: bool,
) -> Result<()> {
    // 1. Move all files of src into dst.
    let src_files: Vec<crate::models::File> = db
        .fetch_all_as::<crate::models::File>(
            "SELECT * FROM drive.files WHERE owner_id = $1 AND folder_id = $2 AND is_trashed = FALSE",
            params![owner_id, src_id],
        )
        .await?;
    for f in src_files {
        files::move_file(db, storage, owner_id, f.id, MoveFileDto { folder_id: dst_id, overwrite, strict: false }).await?;
    }

    // 2. Move / merge each sub-folder recursively.
    let src_sub: Vec<Folder> = db
        .fetch_all_as::<Folder>(
            "SELECT * FROM drive.folders WHERE owner_id = $1 AND parent_id = $2",
            params![owner_id, src_id],
        )
        .await?;
    for sub in src_sub {
        Box::pin(move_folder(db, storage, owner_id, sub.id, MoveFolderDto { parent_id: dst_id, overwrite, strict: false })).await?;
    }

    // 3. Delete the now-empty source folder.
    delete_folder(db, storage, owner_id, src_id).await?;

    Ok(())
}

fn validate_folder_name(name: &str) -> Result<()> {
    if name.is_empty() || name.len() > 255 {
        return Err(FilesError::Validation("Nom de dossier invalide".into()));
    }
    if name.contains('/') || name == ".." || name == "." {
        return Err(FilesError::Validation(
            "Le nom de dossier ne peut pas contenir '/', '..' ou '.'".into(),
        ));
    }
    Ok(())
}

// ── Corbeille — vidage ────────────────────────────────────────────────────────

pub struct PurgeTrashResult {
    pub folders_deleted: u64,
    pub files_deleted: u64,
}

/// Supprime définitivement tous les éléments corbeillés d'un utilisateur.
///
/// Everything that will disappear is enumerated first (its id and display name /
/// path), because a portable hard delete leaves no trigger to write the
/// tombstones the delta feed needs — they are written explicitly here.
pub async fn purge_trash(
    db: &DbPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
) -> Result<PurgeTrashResult> {
    // All folders in every trashed subtree (roots + descendants).
    let folders: Vec<IdPath> = db
        .fetch_all_as::<IdPath>(
            r#"WITH RECURSIVE trashed_tree AS (
                   SELECT id, path FROM drive.folders
                   WHERE owner_id = $1 AND is_trashed = TRUE
                   UNION ALL
                   SELECT f.id, f.path FROM drive.folders f
                   INNER JOIN trashed_tree t ON f.parent_id = t.id
                   WHERE f.owner_id = $2
               )
               SELECT id, path FROM trashed_tree"#,
            params![owner_id, owner_id],
        )
        .await?;
    let folder_ids: Vec<Uuid> = folders.iter().map(|f| f.id).collect();

    // Files to delete: those under a trashed subtree, plus individually trashed
    // ones. Collect (id, name, storage_path), de-duplicated by id.
    #[derive(sqlx::FromRow)]
    struct FileDel {
        id: Uuid,
        name: String,
        storage_path: String,
    }
    let mut by_id: std::collections::HashMap<Uuid, FileDel> = std::collections::HashMap::new();

    let mut qb = DbQueryBuilder::new(
        db.backend(),
        "SELECT id, name, storage_path FROM drive.files WHERE owner_id = ",
    );
    qb.push_bind(owner_id).push(" AND folder_id").push_in(folder_ids.iter().copied());
    for f in qb.fetch_all_as::<FileDel>(db).await? {
        by_id.insert(f.id, f);
    }
    let individual = db
        .fetch_all_as::<FileDel>(
            "SELECT id, name, storage_path FROM drive.files WHERE owner_id = $1 AND is_trashed = TRUE",
            params![owner_id],
        )
        .await?;
    for f in individual {
        by_id.insert(f.id, f);
    }
    let files: Vec<FileDel> = by_id.into_values().collect();

    // Delete the physical blobs.
    for f in &files {
        if let Err(e) = storage.delete(&f.storage_path).await {
            tracing::warn!(path = %f.storage_path, error = %e, "purge_trash: impossible de supprimer le fichier");
        }
    }

    // Hard delete + tombstones, all in one transaction.
    let mut tx = db.begin().await?;
    let files_deleted = if files.is_empty() {
        0
    } else {
        // DELETE FROM drive.files WHERE owner_id = $1 AND id IN (...)
        let ids: Vec<Uuid> = files.iter().map(|f| f.id).collect();
        let in_list = tx.backend().in_list(2, ids.len());
        let sql = format!("DELETE FROM drive.files WHERE owner_id = $1 AND id IN ({in_list})");
        let mut ps: Vec<DbValue> = vec![DbValue::from(owner_id)];
        ps.extend(ids.into_iter().map(DbValue::from));
        tx.execute(&sql, ps).await?
    };
    // Delete the trashed root folders; the cascade removes descendant folders.
    let folders_deleted = tx
        .execute(
            "DELETE FROM drive.folders WHERE owner_id = $1 AND is_trashed = TRUE",
            params![owner_id],
        )
        .await?;
    // Tombstones for every deleted file and folder.
    for f in &files {
        let seq = sync::next_seq(&mut tx).await?;
        sync::record_file_tombstone(&mut tx, f.id, owner_id, &f.name, seq).await?;
    }
    for f in &folders {
        let seq = sync::next_seq(&mut tx).await?;
        sync::record_folder_tombstone(&mut tx, f.id, owner_id, &f.path, seq).await?;
    }
    tx.commit().await?;

    // Remove the physical directories of the trashed folders.
    let paths: Vec<String> = folders.iter().map(|f| f.path.clone()).collect();
    for path in &paths {
        let dir = storage_path::user_folder_dir(owner_id, path);
        if let Err(e) = storage.delete_dir(&dir.to_string_lossy()).await {
            tracing::warn!(path, error = %e, "purge_trash: impossible de supprimer le répertoire");
        }
    }

    Ok(PurgeTrashResult { folders_deleted, files_deleted })
}
