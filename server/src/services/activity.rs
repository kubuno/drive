use chrono::{DateTime, Utc};
use kubuno_db::dialect::SqlType;
use kubuno_db::{params, DbPool};
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

// ── Modèles ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ActivityEntry {
    pub id: i64,
    pub user_id: Uuid,
    pub user_display: String,
    pub action: String,
    pub details: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct OwnerInfo {
    pub id: Uuid,
    pub display_name: Option<String>,
    pub email: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AccessEntry {
    pub share_id: Uuid,
    pub recipient_id: Uuid,
    pub display_name: Option<String>,
    pub email: String,
    pub avatar_url: Option<String>,
    pub can_download: bool,
    pub can_upload: bool,
    pub can_delete: bool,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

// ── Logging ───────────────────────────────────────────────────────────────────

pub async fn log_file(
    db: &DbPool,
    file_id: Uuid,
    user_id: Uuid,
    user_display: &str,
    action: &str,
    details: Value,
) {
    // activity_log.id is auto-increment; it is never bound. `details` is always
    // bound (the JSON column has no portable literal default).
    let result = db
        .execute(
            "INSERT INTO drive.activity_log (file_id, user_id, user_display, action, details)
             VALUES ($1, $2, $3, $4, $5)",
            params![file_id, user_id, user_display, action, details],
        )
        .await;
    if let Err(e) = result {
        tracing::warn!(error = %e, file_id = %file_id, action, "Impossible d'enregistrer l'activité");
    }
}

pub async fn log_folder(
    db: &DbPool,
    folder_id: Uuid,
    user_id: Uuid,
    user_display: &str,
    action: &str,
    details: Value,
) {
    let result = db
        .execute(
            "INSERT INTO drive.activity_log (folder_id, user_id, user_display, action, details)
             VALUES ($1, $2, $3, $4, $5)",
            params![folder_id, user_id, user_display, action, details],
        )
        .await;
    if let Err(e) = result {
        tracing::warn!(error = %e, folder_id = %folder_id, action, "Impossible d'enregistrer l'activité");
    }
}

// ── Queries ───────────────────────────────────────────────────────────────────

pub async fn list_file_activity(db: &DbPool, file_id: Uuid) -> crate::errors::Result<Vec<ActivityEntry>> {
    let rows = db
        .fetch_all_as::<ActivityEntry>(
            "SELECT id, user_id, user_display, action, details, created_at
             FROM drive.activity_log
             WHERE file_id = $1
             ORDER BY created_at DESC
             LIMIT 200",
            params![file_id],
        )
        .await?;
    Ok(rows)
}

/// One activity row enriched with the item it concerns, for the account-wide feed.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ActivityFeedEntry {
    pub id: i64,
    pub user_id: Uuid,
    pub user_display: String,
    pub action: String,
    pub details: Value,
    pub created_at: DateTime<Utc>,
    pub file_id: Option<Uuid>,
    pub folder_id: Option<Uuid>,
    pub item_name: Option<String>,
    pub mime_type: Option<String>,
}

/// Account-wide activity, newest first. `user_id` is bound twice (a placeholder
/// may not be reused).
pub async fn list_user_activity(
    db: &DbPool,
    user_id: Uuid,
    limit: i64,
) -> crate::errors::Result<Vec<ActivityFeedEntry>> {
    let rows = db
        .fetch_all_as::<ActivityFeedEntry>(
            "SELECT a.id, a.user_id, a.user_display, a.action, a.details, a.created_at,
                    a.file_id, a.folder_id,
                    COALESCE(f.name, d.name) AS item_name,
                    f.mime_type              AS mime_type
             FROM drive.activity_log a
             LEFT JOIN drive.files   f ON f.id = a.file_id
             LEFT JOIN drive.folders d ON d.id = a.folder_id
             WHERE (f.id IS NOT NULL AND f.owner_id = $1 AND NOT f.is_trashed)
                OR (d.id IS NOT NULL AND d.owner_id = $2 AND NOT d.is_trashed)
             ORDER BY a.created_at DESC
             LIMIT $3",
            params![user_id, user_id, limit],
        )
        .await?;
    Ok(rows)
}

pub async fn list_folder_activity(db: &DbPool, folder_id: Uuid) -> crate::errors::Result<Vec<ActivityEntry>> {
    let rows = db
        .fetch_all_as::<ActivityEntry>(
            "SELECT id, user_id, user_display, action, details, created_at
             FROM drive.activity_log
             WHERE folder_id = $1
             ORDER BY created_at DESC
             LIMIT 200",
            params![folder_id],
        )
        .await?;
    Ok(rows)
}

// ── Propriétaire (cross-schema) ───────────────────────────────────────────────

/// The `u.email` cast to text portably (`core.users.email` may be a citext/domain
/// on PostgreSQL, a plain varchar elsewhere).
fn email_text(db: &DbPool) -> String {
    db.backend().cast("u.email", SqlType::Text)
}

pub async fn get_file_owner(db: &DbPool, file_id: Uuid) -> crate::errors::Result<Option<OwnerInfo>> {
    let sql = format!(
        "SELECT u.id, u.display_name, {email} AS email, u.avatar_url
         FROM drive.files f
         JOIN core.users u ON u.id = f.owner_id
         WHERE f.id = $1",
        email = email_text(db)
    );
    Ok(db.fetch_optional_as::<OwnerInfo>(&sql, params![file_id]).await?)
}

pub async fn get_folder_owner(db: &DbPool, folder_id: Uuid) -> crate::errors::Result<Option<OwnerInfo>> {
    let sql = format!(
        "SELECT u.id, u.display_name, {email} AS email, u.avatar_url
         FROM drive.folders f
         JOIN core.users u ON u.id = f.owner_id
         WHERE f.id = $1",
        email = email_text(db)
    );
    Ok(db.fetch_optional_as::<OwnerInfo>(&sql, params![folder_id]).await?)
}

// ── Accès (partages internes avec destinataire nommé) ─────────────────────────

pub async fn list_file_access(db: &DbPool, file_id: Uuid) -> crate::errors::Result<Vec<AccessEntry>> {
    let sql = format!(
        "SELECT s.id AS share_id, s.recipient_id, u.display_name, {email} AS email,
                u.avatar_url, s.can_download, s.can_upload, s.can_delete,
                s.expires_at, s.created_at
         FROM drive.shares s
         JOIN core.users u ON u.id = s.recipient_id
         WHERE s.file_id = $1 AND s.recipient_id IS NOT NULL AND s.revoked_at IS NULL
         ORDER BY s.created_at DESC",
        email = email_text(db)
    );
    Ok(db.fetch_all_as::<AccessEntry>(&sql, params![file_id]).await?)
}

pub async fn list_folder_access(db: &DbPool, folder_id: Uuid) -> crate::errors::Result<Vec<AccessEntry>> {
    let sql = format!(
        "SELECT s.id AS share_id, s.recipient_id, u.display_name, {email} AS email,
                u.avatar_url, s.can_download, s.can_upload, s.can_delete,
                s.expires_at, s.created_at
         FROM drive.shares s
         JOIN core.users u ON u.id = s.recipient_id
         WHERE s.folder_id = $1 AND s.recipient_id IS NOT NULL AND s.revoked_at IS NULL
         ORDER BY s.created_at DESC",
        email = email_text(db)
    );
    Ok(db.fetch_all_as::<AccessEntry>(&sql, params![folder_id]).await?)
}
