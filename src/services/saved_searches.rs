use kubuno_db::dialect::SqlType;
use kubuno_db::{params, DbPool};
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

pub async fn list(db: &DbPool, owner_id: Uuid) -> Result<Vec<SavedSearch>> {
    let rows = db
        .fetch_all_as::<SavedSearch>(
            "SELECT * FROM drive.saved_searches WHERE owner_id = $1 ORDER BY position ASC, name ASC",
            params![owner_id],
        )
        .await?;
    Ok(rows)
}

pub async fn create(db: &DbPool, owner_id: Uuid, dto: CreateSavedSearchDto) -> Result<SavedSearch> {
    let name = clean_name(&dto.name)?;
    let filters = dto.filters.unwrap_or_else(|| serde_json::json!({}));

    // Next position, computed separately (MySQL forbids selecting the insert
    // target inside the same statement) and at a portable BIGINT width.
    let next_pos_wide: i64 = db
        .fetch_scalar::<i64>(
            &format!(
                "SELECT {} FROM drive.saved_searches WHERE owner_id = $1",
                db.backend().cast("COALESCE(MAX(position), -1) + 1", SqlType::BigInt)
            ),
            params![owner_id],
        )
        .await?;
    let position = next_pos_wide as i32;

    // Mint the id in Rust and reselect (no RETURNING on MySQL).
    let id = kubuno_db::new_id();
    db.execute(
        "INSERT INTO drive.saved_searches (id, owner_id, name, query, filters, icon, color, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        params![
            id, owner_id, name, dto.query.unwrap_or_default(), filters, dto.icon, dto.color, position
        ],
    )
    .await?;
    db.fetch_one_as::<SavedSearch>("SELECT * FROM drive.saved_searches WHERE id = $1", params![id])
        .await
        .map_err(Into::into)
}

pub async fn update(
    db: &DbPool,
    owner_id: Uuid,
    id: Uuid,
    dto: UpdateSavedSearchDto,
) -> Result<SavedSearch> {
    let name = match dto.name {
        Some(n) => Some(clean_name(&n)?),
        None => None,
    };

    // Ownership check first, so a no-op update (all COALESCE fall through) is not
    // mistaken for "not found" (MySQL reports rows_affected = 0 for a no-op).
    db.fetch_optional_as::<SavedSearch>(
        "SELECT * FROM drive.saved_searches WHERE id = $1 AND owner_id = $2",
        params![id, owner_id],
    )
    .await?
    .ok_or_else(|| FilesError::NotFound("Recherche sauvegardée introuvable".into()))?;

    db.execute(
        "UPDATE drive.saved_searches
         SET name     = COALESCE($1, name),
             query    = COALESCE($2, query),
             filters  = COALESCE($3, filters),
             icon     = COALESCE($4, icon),
             color    = COALESCE($5, color),
             position = COALESCE($6, position)
         WHERE id = $7 AND owner_id = $8",
        params![name, dto.query, dto.filters, dto.icon, dto.color, dto.position, id, owner_id],
    )
    .await?;

    db.fetch_one_as::<SavedSearch>("SELECT * FROM drive.saved_searches WHERE id = $1", params![id])
        .await
        .map_err(Into::into)
}

pub async fn delete(db: &DbPool, owner_id: Uuid, id: Uuid) -> Result<()> {
    let affected = db
        .execute(
            "DELETE FROM drive.saved_searches WHERE id = $1 AND owner_id = $2",
            params![id, owner_id],
        )
        .await?;
    if affected == 0 {
        return Err(FilesError::NotFound("Recherche sauvegardée introuvable".into()));
    }
    Ok(())
}
