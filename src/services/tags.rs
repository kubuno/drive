use sqlx::PgPool;
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
pub async fn list_tags(db: &PgPool, owner_id: Uuid) -> Result<Vec<TagWithCount>> {
    let tags = sqlx::query_as::<_, TagWithCount>(
        "SELECT t.id, t.owner_id, t.name, t.color, t.created_at, t.updated_at,
                COALESCE(ft.cnt, 0) + COALESCE(fo.cnt, 0) AS item_count
         FROM drive.tags t
         LEFT JOIN (SELECT tag_id, COUNT(*) AS cnt FROM drive.file_tags   GROUP BY tag_id) ft ON ft.tag_id = t.id
         LEFT JOIN (SELECT tag_id, COUNT(*) AS cnt FROM drive.folder_tags GROUP BY tag_id) fo ON fo.tag_id = t.id
         WHERE t.owner_id = $1
         ORDER BY t.name ASC",
    )
    .bind(owner_id)
    .fetch_all(db)
    .await?;
    Ok(tags)
}

pub async fn create_tag(db: &PgPool, owner_id: Uuid, dto: CreateTagDto) -> Result<Tag> {
    let name = clean_name(&dto.name)?;
    let color = clean_color(dto.color)?;

    let existing: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM drive.tags WHERE owner_id = $1 AND LOWER(name) = LOWER($2)",
    )
    .bind(owner_id)
    .bind(&name)
    .fetch_optional(db)
    .await?;
    if existing.is_some() {
        return Err(FilesError::Conflict("Une étiquette portant ce nom existe déjà".into()));
    }

    let tag = sqlx::query_as::<_, Tag>(
        "INSERT INTO drive.tags (owner_id, name, color) VALUES ($1, $2, $3) RETURNING *",
    )
    .bind(owner_id)
    .bind(&name)
    .bind(&color)
    .fetch_one(db)
    .await?;
    Ok(tag)
}

pub async fn update_tag(db: &PgPool, owner_id: Uuid, tag_id: Uuid, dto: UpdateTagDto) -> Result<Tag> {
    let name = match dto.name {
        Some(n) => Some(clean_name(&n)?),
        None => None,
    };
    let color = match dto.color {
        Some(c) => Some(clean_color(Some(c))?),
        None => None,
    };

    let tag = sqlx::query_as::<_, Tag>(
        "UPDATE drive.tags
         SET name  = COALESCE($3, name),
             color = COALESCE($4, color)
         WHERE id = $1 AND owner_id = $2
         RETURNING *",
    )
    .bind(tag_id)
    .bind(owner_id)
    .bind(name)
    .bind(color)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| FilesError::NotFound("Étiquette introuvable".into()))?;
    Ok(tag)
}

pub async fn delete_tag(db: &PgPool, owner_id: Uuid, tag_id: Uuid) -> Result<()> {
    let res = sqlx::query("DELETE FROM drive.tags WHERE id = $1 AND owner_id = $2")
        .bind(tag_id)
        .bind(owner_id)
        .execute(db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(FilesError::NotFound("Étiquette introuvable".into()));
    }
    Ok(())
}

/// All tag↔item links for a user, so the UI can paint badges in one fetch.
pub async fn list_assignments(db: &PgPool, owner_id: Uuid) -> Result<Vec<TagAssignment>> {
    let rows = sqlx::query_as::<_, TagAssignment>(
        "SELECT tag_id, file_id AS item_id, 'file'::text AS kind
           FROM drive.file_tags WHERE owner_id = $1
         UNION ALL
         SELECT tag_id, folder_id AS item_id, 'folder'::text AS kind
           FROM drive.folder_tags WHERE owner_id = $1",
    )
    .bind(owner_id)
    .fetch_all(db)
    .await?;
    Ok(rows)
}

async fn assert_tag_owner(db: &PgPool, owner_id: Uuid, tag_id: Uuid) -> Result<()> {
    let ok: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM drive.tags WHERE id = $1 AND owner_id = $2",
    )
    .bind(tag_id)
    .bind(owner_id)
    .fetch_optional(db)
    .await?;
    ok.map(|_| ()).ok_or_else(|| FilesError::NotFound("Étiquette introuvable".into()))
}

pub async fn assign_file_tag(db: &PgPool, owner_id: Uuid, file_id: Uuid, tag_id: Uuid) -> Result<()> {
    assert_tag_owner(db, owner_id, tag_id).await?;
    let owns: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM drive.files WHERE id = $1 AND owner_id = $2",
    )
    .bind(file_id)
    .bind(owner_id)
    .fetch_optional(db)
    .await?;
    if owns.is_none() {
        return Err(FilesError::NotFound("Fichier introuvable".into()));
    }
    sqlx::query(
        "INSERT INTO drive.file_tags (tag_id, file_id, owner_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    )
    .bind(tag_id)
    .bind(file_id)
    .bind(owner_id)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn remove_file_tag(db: &PgPool, owner_id: Uuid, file_id: Uuid, tag_id: Uuid) -> Result<()> {
    sqlx::query(
        "DELETE FROM drive.file_tags WHERE tag_id = $1 AND file_id = $2 AND owner_id = $3",
    )
    .bind(tag_id)
    .bind(file_id)
    .bind(owner_id)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn assign_folder_tag(db: &PgPool, owner_id: Uuid, folder_id: Uuid, tag_id: Uuid) -> Result<()> {
    assert_tag_owner(db, owner_id, tag_id).await?;
    let owns: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM drive.folders WHERE id = $1 AND owner_id = $2",
    )
    .bind(folder_id)
    .bind(owner_id)
    .fetch_optional(db)
    .await?;
    if owns.is_none() {
        return Err(FilesError::NotFound("Dossier introuvable".into()));
    }
    sqlx::query(
        "INSERT INTO drive.folder_tags (tag_id, folder_id, owner_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    )
    .bind(tag_id)
    .bind(folder_id)
    .bind(owner_id)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn remove_folder_tag(db: &PgPool, owner_id: Uuid, folder_id: Uuid, tag_id: Uuid) -> Result<()> {
    sqlx::query(
        "DELETE FROM drive.folder_tags WHERE tag_id = $1 AND folder_id = $2 AND owner_id = $3",
    )
    .bind(tag_id)
    .bind(folder_id)
    .bind(owner_id)
    .execute(db)
    .await?;
    Ok(())
}

/// Files carrying a given tag (excluding trashed), for the dedicated tag view.
pub async fn list_files_by_tag(db: &PgPool, owner_id: Uuid, tag_id: Uuid) -> Result<Vec<File>> {
    let files = sqlx::query_as::<_, File>(
        "SELECT f.* FROM drive.files f
         JOIN drive.file_tags ft ON ft.file_id = f.id
         WHERE ft.tag_id = $1 AND f.owner_id = $2 AND f.is_trashed = FALSE
         ORDER BY f.updated_at DESC",
    )
    .bind(tag_id)
    .bind(owner_id)
    .fetch_all(db)
    .await?;
    Ok(files)
}

/// Folders carrying a given tag (excluding trashed/hidden), for the tag view.
pub async fn list_folders_by_tag(db: &PgPool, owner_id: Uuid, tag_id: Uuid) -> Result<Vec<Folder>> {
    let folders = sqlx::query_as::<_, Folder>(
        "SELECT fo.* FROM drive.folders fo
         JOIN drive.folder_tags ft ON ft.folder_id = fo.id
         WHERE ft.tag_id = $1 AND fo.owner_id = $2 AND fo.is_trashed = FALSE AND fo.is_hidden = FALSE
         ORDER BY fo.name ASC",
    )
    .bind(tag_id)
    .bind(owner_id)
    .fetch_all(db)
    .await?;
    Ok(folders)
}
