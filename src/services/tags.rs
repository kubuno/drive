use kubuno_db::{params, DbPool};
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    models::{CreateTagDto, File, Folder, Tag, TagAssignment, TagWithCount, UpdateTagDto},
};

const MAX_NAME_LEN: usize = 64;
const MAX_COLOR_LEN: usize = 20;

fn clean_name(raw: &str) -> Result<String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(FilesError::Validation("Le nom de l'étiquette est requis".into()));
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(FilesError::Validation("Nom d'étiquette trop long (max 64)".into()));
    }
    Ok(name.to_string())
}

fn clean_color(raw: Option<String>) -> Result<String> {
    let color = raw.unwrap_or_else(|| "gray".to_string());
    let color = color.trim().to_string();
    if color.is_empty() {
        return Ok("gray".to_string());
    }
    if color.len() > MAX_COLOR_LEN {
        return Err(FilesError::Validation("Couleur invalide".into()));
    }
    Ok(color)
}

/// List the user's tags, each annotated with its item count (files + folders).
pub async fn list_tags(db: &DbPool, owner_id: Uuid) -> Result<Vec<TagWithCount>> {
    let b = db.backend();
    // COUNT(*) is bigint on every engine, so item_count decodes as i64 directly.
    let cnt = b.count_bigint("*");
    let sql = format!(
        "SELECT t.id, t.owner_id, t.name, t.color, t.created_at, t.updated_at,
                COALESCE(ft.cnt, 0) + COALESCE(fo.cnt, 0) AS item_count
         FROM drive.tags t
         LEFT JOIN (SELECT tag_id, {cnt} AS cnt FROM drive.file_tags   GROUP BY tag_id) ft ON ft.tag_id = t.id
         LEFT JOIN (SELECT tag_id, {cnt} AS cnt FROM drive.folder_tags GROUP BY tag_id) fo ON fo.tag_id = t.id
         WHERE t.owner_id = $1
         ORDER BY t.name ASC"
    );
    let tags = db.fetch_all_as::<TagWithCount>(&sql, params![owner_id]).await?;
    Ok(tags)
}

pub async fn create_tag(db: &DbPool, owner_id: Uuid, dto: CreateTagDto) -> Result<Tag> {
    let name = clean_name(&dto.name)?;
    let color = clean_color(dto.color)?;

    let existing: Option<Uuid> = db
        .fetch_optional_scalar(
            "SELECT id FROM drive.tags WHERE owner_id = $1 AND LOWER(name) = LOWER($2)",
            params![owner_id, &name],
        )
        .await?;
    if existing.is_some() {
        return Err(FilesError::Conflict("Une étiquette portant ce nom existe déjà".into()));
    }

    // Id minted in Rust (no RETURNING on MySQL); reselect the created row.
    let id = kubuno_db::new_id();
    db.execute(
        "INSERT INTO drive.tags (id, owner_id, name, color) VALUES ($1, $2, $3, $4)",
        params![id, owner_id, &name, &color],
    )
    .await?;
    let tag = db
        .fetch_one_as::<Tag>("SELECT * FROM drive.tags WHERE id = $1", params![id])
        .await?;
    Ok(tag)
}

pub async fn update_tag(db: &DbPool, owner_id: Uuid, tag_id: Uuid, dto: UpdateTagDto) -> Result<Tag> {
    let name = match dto.name {
        Some(n) => Some(clean_name(&n)?),
        None => None,
    };
    let color = match dto.color {
        Some(c) => Some(clean_color(Some(c))?),
        None => None,
    };

    // Check ownership up front rather than on rows_affected: on MySQL an update
    // that changes nothing (both fields None) reports 0 rows, which is not "gone".
    let owns: Option<Uuid> = db
        .fetch_optional_scalar(
            "SELECT id FROM drive.tags WHERE id = $1 AND owner_id = $2",
            params![tag_id, owner_id],
        )
        .await?;
    if owns.is_none() {
        return Err(FilesError::NotFound("Étiquette introuvable".into()));
    }

    db.execute(
        "UPDATE drive.tags
         SET name  = COALESCE($3, name),
             color = COALESCE($4, color)
         WHERE id = $1 AND owner_id = $2",
        params![tag_id, owner_id, name, color],
    )
    .await?;

    let tag = db
        .fetch_one_as::<Tag>("SELECT * FROM drive.tags WHERE id = $1", params![tag_id])
        .await?;
    Ok(tag)
}

pub async fn delete_tag(db: &DbPool, owner_id: Uuid, tag_id: Uuid) -> Result<()> {
    let affected = db
        .execute(
            "DELETE FROM drive.tags WHERE id = $1 AND owner_id = $2",
            params![tag_id, owner_id],
        )
        .await?;
    if affected == 0 {
        return Err(FilesError::NotFound("Étiquette introuvable".into()));
    }
    Ok(())
}

/// All tag↔item links for a user, so the UI can paint badges in one fetch.
pub async fn list_assignments(db: &DbPool, owner_id: Uuid) -> Result<Vec<TagAssignment>> {
    let rows = db
        .fetch_all_as::<TagAssignment>(
            "SELECT tag_id, file_id AS item_id, 'file' AS kind
               FROM drive.file_tags WHERE owner_id = $1
             UNION ALL
             SELECT tag_id, folder_id AS item_id, 'folder' AS kind
               FROM drive.folder_tags WHERE owner_id = $2",
            params![owner_id, owner_id],
        )
        .await?;
    Ok(rows)
}

async fn assert_tag_owner(db: &DbPool, owner_id: Uuid, tag_id: Uuid) -> Result<()> {
    let ok: Option<Uuid> = db
        .fetch_optional_scalar(
            "SELECT id FROM drive.tags WHERE id = $1 AND owner_id = $2",
            params![tag_id, owner_id],
        )
        .await?;
    ok.map(|_| ()).ok_or_else(|| FilesError::NotFound("Étiquette introuvable".into()))
}

pub async fn assign_file_tag(db: &DbPool, owner_id: Uuid, file_id: Uuid, tag_id: Uuid) -> Result<()> {
    assert_tag_owner(db, owner_id, tag_id).await?;
    let owns: Option<Uuid> = db
        .fetch_optional_scalar(
            "SELECT id FROM drive.files WHERE id = $1 AND owner_id = $2",
            params![file_id, owner_id],
        )
        .await?;
    if owns.is_none() {
        return Err(FilesError::NotFound("Fichier introuvable".into()));
    }
    let b = db.backend();
    let sql = format!(
        "INSERT {}INTO drive.file_tags (tag_id, file_id, owner_id, created_at) \
         VALUES ($1, $2, $3, $4){}",
        b.insert_ignore_prefix(),
        b.on_conflict_do_nothing(&["tag_id", "file_id"]),
    );
    db.execute(&sql, params![tag_id, file_id, owner_id, chrono::Utc::now()])
        .await?;
    Ok(())
}

pub async fn remove_file_tag(db: &DbPool, owner_id: Uuid, file_id: Uuid, tag_id: Uuid) -> Result<()> {
    db.execute(
        "DELETE FROM drive.file_tags WHERE tag_id = $1 AND file_id = $2 AND owner_id = $3",
        params![tag_id, file_id, owner_id],
    )
    .await?;
    Ok(())
}

pub async fn assign_folder_tag(db: &DbPool, owner_id: Uuid, folder_id: Uuid, tag_id: Uuid) -> Result<()> {
    assert_tag_owner(db, owner_id, tag_id).await?;
    let owns: Option<Uuid> = db
        .fetch_optional_scalar(
            "SELECT id FROM drive.folders WHERE id = $1 AND owner_id = $2",
            params![folder_id, owner_id],
        )
        .await?;
    if owns.is_none() {
        return Err(FilesError::NotFound("Dossier introuvable".into()));
    }
    let b = db.backend();
    let sql = format!(
        "INSERT {}INTO drive.folder_tags (tag_id, folder_id, owner_id, created_at) \
         VALUES ($1, $2, $3, $4){}",
        b.insert_ignore_prefix(),
        b.on_conflict_do_nothing(&["tag_id", "folder_id"]),
    );
    db.execute(&sql, params![tag_id, folder_id, owner_id, chrono::Utc::now()])
        .await?;
    Ok(())
}

pub async fn remove_folder_tag(db: &DbPool, owner_id: Uuid, folder_id: Uuid, tag_id: Uuid) -> Result<()> {
    db.execute(
        "DELETE FROM drive.folder_tags WHERE tag_id = $1 AND folder_id = $2 AND owner_id = $3",
        params![tag_id, folder_id, owner_id],
    )
    .await?;
    Ok(())
}

/// Files carrying a given tag (excluding trashed), for the dedicated tag view.
pub async fn list_files_by_tag(db: &DbPool, owner_id: Uuid, tag_id: Uuid) -> Result<Vec<File>> {
    let files = db
        .fetch_all_as::<File>(
            "SELECT f.* FROM drive.files f
             JOIN drive.file_tags ft ON ft.file_id = f.id
             WHERE ft.tag_id = $1 AND f.owner_id = $2 AND f.is_trashed = FALSE
             ORDER BY f.updated_at DESC",
            params![tag_id, owner_id],
        )
        .await?;
    Ok(files)
}

/// Folders carrying a given tag (excluding trashed/hidden), for the tag view.
pub async fn list_folders_by_tag(db: &DbPool, owner_id: Uuid, tag_id: Uuid) -> Result<Vec<Folder>> {
    let folders = db
        .fetch_all_as::<Folder>(
            "SELECT fo.* FROM drive.folders fo
             JOIN drive.folder_tags ft ON ft.folder_id = fo.id
             WHERE ft.tag_id = $1 AND fo.owner_id = $2 AND fo.is_trashed = FALSE AND fo.is_hidden = FALSE
             ORDER BY fo.name ASC",
            params![tag_id, owner_id],
        )
        .await?;
    Ok(folders)
}
