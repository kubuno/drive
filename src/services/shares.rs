use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand::Rng;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    models::{CreateShareDto, File, Folder, RecipientHit, Share, ShareWithTarget},
};

fn generate_token() -> String {
    let mut rng = rand::thread_rng();
    let bytes: [u8; 24] = rng.gen();
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(bytes)
}

/// Hashes a share link password with argon2id (same scheme as core account passwords).
fn hash_share_password(password: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| FilesError::Internal(anyhow::anyhow!("Erreur hachage: {e}")))?
        .to_string();
    Ok(hash)
}

/// Verifies a candidate password against a stored argon2 hash.
fn verify_share_password(password: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

/// Returns true when the share is accessible given the provided password.
/// A share with no password is always accessible; otherwise the candidate must match.
pub fn share_password_ok(share: &Share, provided: Option<&str>) -> bool {
    match &share.password_hash {
        None => true,
        Some(hash) => provided.map(|pw| verify_share_password(pw, hash)).unwrap_or(false),
    }
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

    // Optional password protection (public links only).
    let password_hash = match dto.password.as_deref().map(str::trim) {
        Some(pw) if !pw.is_empty() => Some(hash_share_password(pw)?),
        _ => None,
    };

    let share = sqlx::query_as::<_, Share>(
        "INSERT INTO drive.shares
            (owner_id, file_id, folder_id, token, recipient_id,
             can_download, can_upload, can_delete, password_hash, expires_at, max_downloads)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
    .bind(&password_hash)
    .bind(dto.expires_at)
    .bind(dto.max_downloads)
    .fetch_one(db)
    .await?;

    Ok(share)
}

/// Links the current user created, enriched with the target item name/kind.
/// `password_hash` is never exposed — only a `password_protected` boolean.
pub async fn list_shares_enriched(db: &PgPool, owner_id: Uuid) -> Result<Vec<ShareWithTarget>> {
    let shares = sqlx::query_as::<_, ShareWithTarget>(
        "SELECT s.id, s.owner_id, s.file_id, s.folder_id, s.token, s.recipient_id,
                s.can_download, s.can_upload, s.can_delete,
                (s.password_hash IS NOT NULL) AS password_protected,
                s.expires_at, s.download_count, s.max_downloads,
                s.created_at, s.updated_at, s.revoked_at,
                COALESCE(f.name, fo.name) AS item_name,
                CASE WHEN s.file_id IS NOT NULL THEN 'file' ELSE 'folder' END AS item_kind,
                NULL::text AS owner_name
         FROM drive.shares s
         LEFT JOIN drive.files   f  ON f.id  = s.file_id
         LEFT JOIN drive.folders fo ON fo.id = s.folder_id
         WHERE s.owner_id = $1 AND s.revoked_at IS NULL
         ORDER BY s.created_at DESC",
    )
    .bind(owner_id)
    .fetch_all(db)
    .await?;
    Ok(shares)
}

/// Internal shares targeting the current user ("shared with me"), enriched with
/// the item name and the sharer's display name. Expired shares are excluded.
pub async fn list_received_shares(db: &PgPool, recipient_id: Uuid) -> Result<Vec<ShareWithTarget>> {
    let shares = sqlx::query_as::<_, ShareWithTarget>(
        "SELECT s.id, s.owner_id, s.file_id, s.folder_id, s.token, s.recipient_id,
                s.can_download, s.can_upload, s.can_delete,
                (s.password_hash IS NOT NULL) AS password_protected,
                s.expires_at, s.download_count, s.max_downloads,
                s.created_at, s.updated_at, s.revoked_at,
                COALESCE(f.name, fo.name) AS item_name,
                CASE WHEN s.file_id IS NOT NULL THEN 'file' ELSE 'folder' END AS item_kind,
                u.display_name AS owner_name
         FROM drive.shares s
         LEFT JOIN drive.files   f  ON f.id  = s.file_id
         LEFT JOIN drive.folders fo ON fo.id = s.folder_id
         LEFT JOIN core.users    u  ON u.id  = s.owner_id
         WHERE s.recipient_id = $1 AND s.revoked_at IS NULL
           AND (s.expires_at IS NULL OR s.expires_at > NOW())
         ORDER BY s.created_at DESC",
    )
    .bind(recipient_id)
    .fetch_all(db)
    .await?;
    Ok(shares)
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

/// Resolves the actual folders/files internally shared WITH the user (for the
/// "Partagés avec moi" view). Bypasses ownership — that's the point of a share.
pub async fn list_received_items(db: &PgPool, recipient_id: Uuid) -> Result<(Vec<Folder>, Vec<File>)> {
    let files = sqlx::query_as::<_, File>(
        "SELECT DISTINCT f.* FROM drive.files f
         JOIN drive.shares s ON s.file_id = f.id
         WHERE s.recipient_id = $1 AND s.revoked_at IS NULL
           AND (s.expires_at IS NULL OR s.expires_at > NOW())
           AND f.is_trashed = FALSE
         ORDER BY f.updated_at DESC",
    )
    .bind(recipient_id)
    .fetch_all(db)
    .await?;

    let folders = sqlx::query_as::<_, Folder>(
        "SELECT DISTINCT fo.* FROM drive.folders fo
         JOIN drive.shares s ON s.folder_id = fo.id
         WHERE s.recipient_id = $1 AND s.revoked_at IS NULL
           AND (s.expires_at IS NULL OR s.expires_at > NOW())
           AND fo.is_trashed = FALSE
         ORDER BY fo.name ASC",
    )
    .bind(recipient_id)
    .fetch_all(db)
    .await?;

    Ok((folders, files))
}

/// True when a file is internally shared with the user via an active share.
pub async fn is_file_shared_with(db: &PgPool, user_id: Uuid, file_id: Uuid) -> Result<bool> {
    let found: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM drive.shares
         WHERE file_id = $1 AND recipient_id = $2 AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())
         LIMIT 1",
    )
    .bind(file_id)
    .bind(user_id)
    .fetch_optional(db)
    .await?;
    Ok(found.is_some())
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
