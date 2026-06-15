use rand::Rng;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    models::{CreateShareDto, RecipientHit, Share},
};

fn generate_token() -> String {
    let mut rng = rand::thread_rng();
    let bytes: [u8; 24] = rng.gen();
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(bytes)
}

pub async fn create_share(
    db: &PgPool,
    owner_id: Uuid,
    dto: CreateShareDto,
) -> Result<Share> {
    if dto.file_id.is_none() && dto.folder_id.is_none() {
        return Err(FilesError::Validation("file_id ou folder_id requis".into()));
    }
    if dto.file_id.is_some() && dto.folder_id.is_some() {
        return Err(FilesError::Validation("file_id et folder_id sont exclusifs".into()));
    }

    // Pour un lien public, on génère un token sauf si c'est un partage interne
    let token = if dto.recipient_id.is_none() {
        Some(generate_token())
    } else {
        None
    };

    let share = sqlx::query_as::<_, Share>(
        "INSERT INTO drive.shares
            (owner_id, file_id, folder_id, token, recipient_id,
             can_download, can_upload, can_delete, expires_at, max_downloads)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *"
    )
    .bind(owner_id)
    .bind(dto.file_id)
    .bind(dto.folder_id)
    .bind(&token)
    .bind(dto.recipient_id)
    .bind(dto.can_download.unwrap_or(true))
    .bind(dto.can_upload.unwrap_or(false))
    .bind(dto.can_delete.unwrap_or(false))
    .bind(dto.expires_at)
    .bind(dto.max_downloads)
    .fetch_one(db)
    .await?;

    Ok(share)
}

pub async fn get_share_by_token(db: &PgPool, token: &str) -> Result<Share> {
    sqlx::query_as::<_, Share>(
        "SELECT * FROM drive.shares
         WHERE token = $1 AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
         AND (max_downloads IS NULL OR download_count < max_downloads)"
    )
    .bind(token)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| FilesError::NotFound("Partage introuvable ou expiré".into()))
}

pub async fn list_shares(db: &PgPool, owner_id: Uuid) -> Result<Vec<Share>> {
    let shares = sqlx::query_as::<_, Share>(
        "SELECT * FROM drive.shares
         WHERE owner_id = $1 AND revoked_at IS NULL
         ORDER BY created_at DESC"
    )
    .bind(owner_id)
    .fetch_all(db)
    .await?;
    Ok(shares)
}

pub async fn revoke_share(db: &PgPool, owner_id: Uuid, share_id: Uuid) -> Result<()> {
    let result = sqlx::query(
        "UPDATE drive.shares SET revoked_at = NOW()
         WHERE id = $1 AND owner_id = $2 AND revoked_at IS NULL"
    )
    .bind(share_id)
    .bind(owner_id)
    .execute(db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(FilesError::NotFound(format!("Partage {share_id} introuvable")));
    }
    Ok(())
}

/// Recherche des utilisateurs avec qui partager (par nom, email ou identifiant),
/// en excluant l'utilisateur courant. Interroge directement `core.users`.
pub async fn search_recipients(
    db: &PgPool,
    exclude_user: Uuid,
    query: &str,
    limit: i64,
) -> Result<Vec<RecipientHit>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let pattern = format!("%{q}%");
    let hits = sqlx::query_as::<_, RecipientHit>(
        r#"SELECT id, display_name, email::text as email, avatar_url
           FROM core.users
           WHERE is_active = TRUE
             AND id <> $1
             AND (email::text ILIKE $2 OR username ILIKE $2 OR display_name ILIKE $2)
           ORDER BY display_name NULLS LAST, email
           LIMIT $3"#,
    )
    .bind(exclude_user)
    .bind(&pattern)
    .bind(limit.clamp(1, 50))
    .fetch_all(db)
    .await?;
    Ok(hits)
}

pub async fn increment_download_count(db: &PgPool, share_id: Uuid) -> Result<()> {
    sqlx::query(
        "UPDATE drive.shares SET download_count = download_count + 1 WHERE id = $1"
    )
    .bind(share_id)
    .execute(db)
    .await?;
    Ok(())
}

use base64::Engine as _;
