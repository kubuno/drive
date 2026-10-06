use kubuno_db::{params, DbPool};
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    models::{CreatePdfCommentDto, PdfComment},
    services::files,
};

/// Lists comments on a document, newest first. The caller must be able to read
/// the file (owned or internally shared) — enforced before calling.
pub async fn list_comments(db: &DbPool, file_id: Uuid) -> Result<Vec<PdfComment>> {
    let rows = db
        .fetch_all_as::<PdfComment>(
            "SELECT c.id, c.file_id, c.author_id, u.display_name AS author_name,
                    c.page, c.x, c.y, c.w, c.h, c.body, c.resolved, c.created_at, c.updated_at
             FROM drive.pdf_comments c
             LEFT JOIN core.users u ON u.id = c.author_id
             WHERE c.file_id = $1
             ORDER BY c.created_at ASC",
            params![file_id],
        )
        .await?;
    Ok(rows)
}

/// Creates a comment anchored to a page region. Coordinates are clamped to
/// [0,1] and the body is trimmed; an empty body is rejected.
pub async fn create_comment(
    db: &DbPool,
    author_id: Uuid,
    file_id: Uuid,
    dto: CreatePdfCommentDto,
) -> Result<PdfComment> {
    let body = dto.body.trim().to_string();
    if body.is_empty() {
        return Err(FilesError::Validation("Commentaire vide".into()));
    }
    if body.len() > 10_000 {
        return Err(FilesError::Validation("Commentaire trop long".into()));
    }
    if dto.page < 1 {
        return Err(FilesError::Validation("Page invalide".into()));
    }
    let clamp01 = |v: f64| v.clamp(0.0, 1.0);
    let x = clamp01(dto.x);
    let y = clamp01(dto.y);
    let w = clamp01(dto.w).min(1.0 - x);
    let h = clamp01(dto.h).min(1.0 - y);

    // The id is minted here (no RETURNING on MySQL); the row is then reselected.
    let id = kubuno_db::new_id();
    db.execute(
        "INSERT INTO drive.pdf_comments (id, file_id, author_id, page, x, y, w, h, body)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        params![id, file_id, author_id, dto.page, x, y, w, h, &body],
    )
    .await?;

    get_comment(db, id).await
}

/// Fetches a single comment enriched with its author's display name.
pub async fn get_comment(db: &DbPool, id: Uuid) -> Result<PdfComment> {
    db.fetch_optional_as::<PdfComment>(
        "SELECT c.id, c.file_id, c.author_id, u.display_name AS author_name,
                c.page, c.x, c.y, c.w, c.h, c.body, c.resolved, c.created_at, c.updated_at
         FROM drive.pdf_comments c
         LEFT JOIN core.users u ON u.id = c.author_id
         WHERE c.id = $1",
        params![id],
    )
    .await?
    .ok_or_else(|| FilesError::NotFound("Commentaire introuvable".into()))
}

/// Toggles a comment's resolved flag. Only the author or an admin may resolve.
pub async fn set_resolved(
    db: &DbPool,
    user_id: Uuid,
    is_admin: bool,
    id: Uuid,
    resolved: bool,
) -> Result<PdfComment> {
    // The row is reselected by id afterwards, so the existence check rides on the
    // author guard here rather than on rows_affected (which is 0 on MySQL for an
    // update that changed nothing).
    let owns: Option<Uuid> = db
        .fetch_optional_scalar(
            "SELECT id FROM drive.pdf_comments WHERE id = $1 AND ($2 OR author_id = $3)",
            params![id, is_admin, user_id],
        )
        .await?;
    if owns.is_none() {
        return Err(FilesError::Forbidden);
    }
    db.execute(
        "UPDATE drive.pdf_comments SET resolved = $1, updated_at = $2 WHERE id = $3",
        params![resolved, chrono::Utc::now(), id],
    )
    .await?;
    get_comment(db, id).await
}

/// Deletes a comment. Only the author or an admin may delete it.
pub async fn delete_comment(db: &DbPool, user_id: Uuid, is_admin: bool, id: Uuid) -> Result<()> {
    let affected = db
        .execute(
            "DELETE FROM drive.pdf_comments WHERE id = $1 AND ($2 OR author_id = $3)",
            params![id, is_admin, user_id],
        )
        .await?;
    if affected == 0 {
        return Err(FilesError::Forbidden);
    }
    Ok(())
}

/// Ensures the user can read the file before touching its comments.
pub async fn assert_readable(db: &DbPool, user_id: Uuid, file_id: Uuid) -> Result<()> {
    files::get_file_readable(db, user_id, file_id).await.map(|_| ())
}
