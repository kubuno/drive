use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{DateTime, Duration, Utc};
use kubuno_db::dialect::{Backend, SqlType};
use kubuno_db::{params, DbPool};
use rand::Rng;
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    models::{CreateShareDto, File, Folder, RecipientHit, Share, ShareWithTarget},
};

fn generate_token() -> String {
    let mut rng = rand::thread_rng();
    let bytes: [u8; 24] = rng.gen();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
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
        Ok(parsed) => Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok(),
        Err(_) => false,
    }
}

/// Returns true when the share is accessible given the provided password.
pub fn share_password_ok(share: &Share, provided: Option<&str>) -> bool {
    match &share.password_hash {
        None => true,
        Some(hash) => provided.map(|pw| verify_share_password(pw, hash)).unwrap_or(false),
    }
}

/// The instance policy on PUBLIC links, as the administrator left it in the console.
#[derive(Debug, Clone, Copy)]
pub struct SharePolicy {
    pub public_links_enabled: bool,
    pub max_expiry_days: i64,
    pub default_expiry_days: i64,
    pub require_password: bool,
    pub download_enabled: bool,
    pub max_downloads: i64,
}

impl Default for SharePolicy {
    fn default() -> Self {
        Self {
            public_links_enabled: true,
            max_expiry_days: 0,
            default_expiry_days: 0,
            require_password: false,
            download_enabled: true,
            max_downloads: 0,
        }
    }
}

/// The columns shared by the two enriched-listing queries, plus the raw
/// `password_hash` (so `password_protected` is derived in Rust — a boolean-valued
/// SQL expression decodes as bool on PostgreSQL/SQLite but not on MySQL). The
/// owner name is only joined in "shared with me"; elsewhere the column is absent
/// and `#[sqlx(default)]` leaves it `None`.
#[derive(sqlx::FromRow)]
struct EnrichedRow {
    id: Uuid,
    owner_id: Uuid,
    file_id: Option<Uuid>,
    folder_id: Option<Uuid>,
    token: Option<String>,
    recipient_id: Option<Uuid>,
    can_download: bool,
    can_upload: bool,
    can_delete: bool,
    password_hash: Option<String>,
    expires_at: Option<DateTime<Utc>>,
    download_count: i32,
    max_downloads: Option<i32>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    revoked_at: Option<DateTime<Utc>>,
    item_name: Option<String>,
    item_kind: String,
    #[sqlx(default)]
    owner_name: Option<String>,
}

impl From<EnrichedRow> for ShareWithTarget {
    fn from(r: EnrichedRow) -> Self {
        ShareWithTarget {
            id: r.id,
            owner_id: r.owner_id,
            file_id: r.file_id,
            folder_id: r.folder_id,
            token: r.token,
            recipient_id: r.recipient_id,
            can_download: r.can_download,
            can_upload: r.can_upload,
            can_delete: r.can_delete,
            password_protected: r.password_hash.is_some(),
            expires_at: r.expires_at,
            download_count: r.download_count,
            max_downloads: r.max_downloads,
            created_at: r.created_at,
            updated_at: r.updated_at,
            revoked_at: r.revoked_at,
            item_name: r.item_name,
            item_kind: r.item_kind,
            owner_name: r.owner_name,
        }
    }
}

/// Create a share. `policy` is applied to PUBLIC links only.
pub async fn create_share(
    db: &DbPool,
    owner_id: Uuid,
    dto: CreateShareDto,
    policy: SharePolicy,
) -> Result<Share> {
    if dto.file_id.is_none() && dto.folder_id.is_none() {
        return Err(FilesError::Validation("file_id ou folder_id requis".into()));
    }
    if dto.file_id.is_some() && dto.folder_id.is_some() {
        return Err(FilesError::Validation("file_id et folder_id sont exclusifs".into()));
    }

    let is_public = dto.recipient_id.is_none();

    if is_public && !policy.public_links_enabled {
        return Err(FilesError::PolicyDisabled(
            "Les liens de partage public sont désactivés sur cette instance".into(),
        ));
    }

    let password = dto.password.as_deref().map(str::trim).filter(|pw| !pw.is_empty());

    if is_public && policy.require_password && password.is_none() {
        return Err(FilesError::PolicyDisabled(
            "Cette instance exige un mot de passe sur tout lien de partage public".into(),
        ));
    }

    let expires_at = if is_public {
        let requested = match (dto.expires_at, policy.default_expiry_days) {
            (None, days) if days > 0 => Some(Utc::now() + Duration::days(days)),
            (other, _) => other,
        };
        if policy.max_expiry_days > 0 {
            let cap = Utc::now() + Duration::days(policy.max_expiry_days);
            match requested {
                Some(r) if r <= cap => Some(r),
                _ => Some(cap),
            }
        } else {
            requested
        }
    } else {
        dto.expires_at
    };

    let token = if is_public { Some(generate_token()) } else { None };

    let password_hash = match password {
        Some(pw) => Some(hash_share_password(pw)?),
        None => None,
    };

    let can_download = dto.can_download.unwrap_or(true) && (!is_public || policy.download_enabled);

    let max_downloads = match (dto.max_downloads, policy.max_downloads) {
        (_, cap) if cap <= 0 || !is_public => dto.max_downloads,
        (Some(n), cap) if (n as i64) <= cap => Some(n),
        (_, cap) => Some(cap as i32),
    };

    // Mint the id in Rust and reselect (no RETURNING on MySQL).
    let id = kubuno_db::new_id();
    db.execute(
        "INSERT INTO drive.shares
            (id, owner_id, file_id, folder_id, token, recipient_id,
             can_download, can_upload, can_delete, password_hash, expires_at, max_downloads)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
        params![
            id, owner_id, dto.file_id, dto.folder_id, token, dto.recipient_id, can_download,
            dto.can_upload.unwrap_or(false), dto.can_delete.unwrap_or(false), password_hash,
            expires_at, max_downloads
        ],
    )
    .await?;
    db.fetch_one_as::<Share>("SELECT * FROM drive.shares WHERE id = $1", params![id])
        .await
        .map_err(Into::into)
}

/// Links the current user created, enriched with the target item name/kind.
pub async fn list_shares_enriched(db: &DbPool, owner_id: Uuid) -> Result<Vec<ShareWithTarget>> {
    let rows = db
        .fetch_all_as::<EnrichedRow>(
            "SELECT s.id, s.owner_id, s.file_id, s.folder_id, s.token, s.recipient_id,
                    s.can_download, s.can_upload, s.can_delete, s.password_hash,
                    s.expires_at, s.download_count, s.max_downloads,
                    s.created_at, s.updated_at, s.revoked_at,
                    COALESCE(f.name, fo.name) AS item_name,
                    CASE WHEN s.file_id IS NOT NULL THEN 'file' ELSE 'folder' END AS item_kind
             FROM drive.shares s
             LEFT JOIN drive.files   f  ON f.id  = s.file_id
             LEFT JOIN drive.folders fo ON fo.id = s.folder_id
             WHERE s.owner_id = $1 AND s.revoked_at IS NULL
             ORDER BY s.created_at DESC",
            params![owner_id],
        )
        .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

/// Internal shares targeting the current user ("shared with me"). Expired excluded.
pub async fn list_received_shares(db: &DbPool, recipient_id: Uuid) -> Result<Vec<ShareWithTarget>> {
    let rows = db
        .fetch_all_as::<EnrichedRow>(
            "SELECT s.id, s.owner_id, s.file_id, s.folder_id, s.token, s.recipient_id,
                    s.can_download, s.can_upload, s.can_delete, s.password_hash,
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
               AND (s.expires_at IS NULL OR s.expires_at > $2)
             ORDER BY s.created_at DESC",
            params![recipient_id, Utc::now()],
        )
        .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn get_share_by_token(db: &DbPool, token: &str) -> Result<Share> {
    db.fetch_optional_as::<Share>(
        "SELECT * FROM drive.shares
         WHERE token = $1 AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > $2)
         AND (max_downloads IS NULL OR download_count < max_downloads)",
        params![token, Utc::now()],
    )
    .await?
    .ok_or_else(|| FilesError::NotFound("Partage introuvable ou expiré".into()))
}

pub async fn list_shares(db: &DbPool, owner_id: Uuid) -> Result<Vec<Share>> {
    let shares = db
        .fetch_all_as::<Share>(
            "SELECT * FROM drive.shares
             WHERE owner_id = $1 AND revoked_at IS NULL
             ORDER BY created_at DESC",
            params![owner_id],
        )
        .await?;
    Ok(shares)
}

pub async fn revoke_share(db: &DbPool, owner_id: Uuid, share_id: Uuid) -> Result<()> {
    let affected = db
        .execute(
            "UPDATE drive.shares SET revoked_at = $1
             WHERE id = $2 AND owner_id = $3 AND revoked_at IS NULL",
            params![Utc::now(), share_id, owner_id],
        )
        .await?;
    if affected == 0 {
        return Err(FilesError::NotFound(format!("Partage {share_id} introuvable")));
    }
    Ok(())
}

/// Recherche des utilisateurs avec qui partager. Interroge directement `core.users`.
pub async fn search_recipients(
    db: &DbPool,
    exclude_user: Uuid,
    query: &str,
    limit: i64,
) -> Result<Vec<RecipientHit>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let pattern = format!("%{q}%");
    let b = db.backend();
    let email = b.cast("email", SqlType::Text);
    // Case-insensitive match on the email cast (a run-time expression, so the
    // `ilike` helper — which takes a `&'static str` column — cannot be used on
    // it). Each pattern is bound to its own placeholder (no reuse); `NULLS LAST`
    // is dropped (MySQL rejects it).
    let email_ilike = match b {
        Backend::Postgres => format!("{email} ILIKE $2"),
        _ => format!("LOWER({email}) LIKE LOWER($2)"),
    };
    let sql = format!(
        "SELECT id, display_name, {email} AS email, avatar_url
         FROM core.users
         WHERE is_active = TRUE
           AND id <> $1
           AND ({email_ilike} OR {u3} OR {d4})
         ORDER BY display_name, email
         LIMIT $5",
        u3 = b.ilike("username", 3),
        d4 = b.ilike("display_name", 4),
    );
    let hits = db
        .fetch_all_as::<RecipientHit>(
            &sql,
            params![exclude_user, &pattern, &pattern, &pattern, limit.clamp(1, 50)],
        )
        .await?;
    Ok(hits)
}

/// Resolves the actual folders/files internally shared WITH the user.
pub async fn list_received_items(db: &DbPool, recipient_id: Uuid) -> Result<(Vec<Folder>, Vec<File>)> {
    let files = db
        .fetch_all_as::<File>(
            "SELECT DISTINCT f.* FROM drive.files f
             JOIN drive.shares s ON s.file_id = f.id
             WHERE s.recipient_id = $1 AND s.revoked_at IS NULL
               AND (s.expires_at IS NULL OR s.expires_at > $2)
               AND f.is_trashed = FALSE
             ORDER BY f.updated_at DESC",
            params![recipient_id, Utc::now()],
        )
        .await?;

    let folders = db
        .fetch_all_as::<Folder>(
            "SELECT DISTINCT fo.* FROM drive.folders fo
             JOIN drive.shares s ON s.folder_id = fo.id
             WHERE s.recipient_id = $1 AND s.revoked_at IS NULL
               AND (s.expires_at IS NULL OR s.expires_at > $2)
               AND fo.is_trashed = FALSE
             ORDER BY fo.name ASC",
            params![recipient_id, Utc::now()],
        )
        .await?;

    Ok((folders, files))
}

/// True when a file is internally shared with the user via an active share.
pub async fn is_file_shared_with(db: &DbPool, user_id: Uuid, file_id: Uuid) -> Result<bool> {
    let found = db
        .fetch_optional_scalar::<Uuid>(
            "SELECT id FROM drive.shares
             WHERE file_id = $1 AND recipient_id = $2 AND revoked_at IS NULL
               AND (expires_at IS NULL OR expires_at > $3)
             LIMIT 1",
            params![file_id, user_id, Utc::now()],
        )
        .await?;
    Ok(found.is_some())
}

pub async fn increment_download_count(db: &DbPool, share_id: Uuid) -> Result<()> {
    db.execute(
        "UPDATE drive.shares SET download_count = download_count + 1 WHERE id = $1",
        params![share_id],
    )
    .await?;
    Ok(())
}

use base64::Engine as _;
