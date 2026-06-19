use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    models::{CreateSavedSearchDto, SavedSearch, UpdateSavedSearchDto},
};

fn clean_name(raw: &str) -> Result<String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(FilesError::Validation("Le nom est requis".into()));
    }
    if name.chars().count() > 120 {
        return Err(FilesError::Validation("Nom trop long (max 120)".into()));
    }
    Ok(name.to_string())
}

pub async fn list(db: &PgPool, owner_id: Uuid) -> Result<Vec<SavedSearch>> {
    let rows = sqlx::query_as::<_, SavedSearch>(
        "SELECT * FROM drive.saved_searches WHERE owner_id = $1 ORDER BY position ASC, name ASC",
    )
    .bind(owner_id)
    .fetch_all(db)
    .await?;
    Ok(rows)
}

pub async fn create(db: &PgPool, owner_id: Uuid, dto: CreateSavedSearchDto) -> Result<SavedSearch> {
    let name = clean_name(&dto.name)?;
    let filters = dto.filters.unwrap_or_else(|| serde_json::json!({}));
    let row = sqlx::query_as::<_, SavedSearch>(
        "INSERT INTO drive.saved_searches (owner_id, name, query, filters, icon, color, position)
         VALUES ($1, $2, $3, $4, $5, $6,
                 COALESCE((SELECT MAX(position) + 1 FROM drive.saved_searches WHERE owner_id = $1), 0))
         RETURNING *",
    )
    .bind(owner_id)
    .bind(&name)
    .bind(dto.query.unwrap_or_default())
    .bind(filters)
    .bind(dto.icon)
    .bind(dto.color)
    .fetch_one(db)
    .await?;
    Ok(row)
}

pub async fn update(
    db: &PgPool,
    owner_id: Uuid,
    id: Uuid,
    dto: UpdateSavedSearchDto,
) -> Result<SavedSearch> {
    let name = match dto.name {
        Some(n) => Some(clean_name(&n)?),
        None => None,
    };
    let row = sqlx::query_as::<_, SavedSearch>(
        "UPDATE drive.saved_searches
         SET name     = COALESCE($3, name),
             query    = COALESCE($4, query),
             filters  = COALESCE($5, filters),
             icon     = COALESCE($6, icon),
             color    = COALESCE($7, color),
             position = COALESCE($8, position)
         WHERE id = $1 AND owner_id = $2
         RETURNING *",
    )
    .bind(id)
    .bind(owner_id)
    .bind(name)
    .bind(dto.query)
    .bind(dto.filters)
    .bind(dto.icon)
    .bind(dto.color)
    .bind(dto.position)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| FilesError::NotFound("Recherche sauvegardée introuvable".into()))?;
    Ok(row)
}

pub async fn delete(db: &PgPool, owner_id: Uuid, id: Uuid) -> Result<()> {
    let res = sqlx::query("DELETE FROM drive.saved_searches WHERE id = $1 AND owner_id = $2")
        .bind(id)
        .bind(owner_id)
        .execute(db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(FilesError::NotFound("Recherche sauvegardée introuvable".into()));
    }
    Ok(())
}
