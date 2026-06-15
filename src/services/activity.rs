use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

// ── Modèles ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ActivityEntry {
    pub id:           i64,
    pub user_id:      Uuid,
    pub user_display: String,
    pub action:       String,
    pub details:      Value,
    pub created_at:   DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct OwnerInfo {
    pub id:           Uuid,
    pub display_name: Option<String>,
    pub email:        String,
    pub avatar_url:   Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AccessEntry {
    pub share_id:     Uuid,
    pub recipient_id: Uuid,
    pub display_name: Option<String>,
    pub email:        String,
    pub avatar_url:   Option<String>,
    pub can_download: bool,
    pub can_upload:   bool,
    pub can_delete:   bool,
    pub expires_at:   Option<DateTime<Utc>>,
    pub created_at:   DateTime<Utc>,
}

// ── Logging ───────────────────────────────────────────────────────────────────

pub async fn log_file(
    db:           &PgPool,
    file_id:      Uuid,
    user_id:      Uuid,
    user_display: &str,
    action:       &str,
    details:      Value,
) {
    let result = sqlx::query(
        "INSERT INTO drive.activity_log (file_id, user_id, user_display, action, details)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(file_id)
    .bind(user_id)
    .bind(user_display)
    .bind(action)
    .bind(&details)
    .execute(db)
    .await;

    if let Err(e) = result {
        tracing::warn!(error = %e, file_id = %file_id, action, "Impossible d'enregistrer l'activité");
    }
}

pub async fn log_folder(
    db:           &PgPool,
    folder_id:    Uuid,
    user_id:      Uuid,
    user_display: &str,
    action:       &str,
    details:      Value,
) {
    let result = sqlx::query(
        "INSERT INTO drive.activity_log (folder_id, user_id, user_display, action, details)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(folder_id)
    .bind(user_id)
    .bind(user_display)
    .bind(action)
    .bind(&details)
    .execute(db)
    .await;

    if let Err(e) = result {
        tracing::warn!(error = %e, folder_id = %folder_id, action, "Impossible d'enregistrer l'activité");
    }
}

// ── Queries ───────────────────────────────────────────────────────────────────

pub async fn list_file_activity(
    db:      &PgPool,
    file_id: Uuid,
) -> crate::errors::Result<Vec<ActivityEntry>> {
    let rows = sqlx::query_as::<_, ActivityEntry>(
        "SELECT id, user_id, user_display, action, details, created_at
         FROM drive.activity_log
         WHERE file_id = $1
         ORDER BY created_at DESC
         LIMIT 200",
    )
    .bind(file_id)
    .fetch_all(db)
    .await?;
    Ok(rows)
}

pub async fn list_folder_activity(
    db:        &PgPool,
    folder_id: Uuid,
) -> crate::errors::Result<Vec<ActivityEntry>> {
    let rows = sqlx::query_as::<_, ActivityEntry>(
        "SELECT id, user_id, user_display, action, details, created_at
         FROM drive.activity_log
         WHERE folder_id = $1
         ORDER BY created_at DESC
         LIMIT 200",
    )
    .bind(folder_id)
    .fetch_all(db)
    .await?;
    Ok(rows)
}

// ── Propriétaire (cross-schema) ───────────────────────────────────────────────

pub async fn get_file_owner(db: &PgPool, file_id: Uuid) -> crate::errors::Result<Option<OwnerInfo>> {
    let row = sqlx::query_as::<_, (Uuid, Option<String>, String, Option<String>)>(
        r#"SELECT u.id, u.display_name, u.email::text, u.avatar_url
           FROM drive.files f
           JOIN core.users u ON u.id = f.owner_id
           WHERE f.id = $1"#,
    )
    .bind(file_id)
    .fetch_optional(db)
    .await?;

    Ok(row.map(|(id, display_name, email, avatar_url)| OwnerInfo { id, display_name, email, avatar_url }))
}

pub async fn get_folder_owner(db: &PgPool, folder_id: Uuid) -> crate::errors::Result<Option<OwnerInfo>> {
    let row = sqlx::query_as::<_, (Uuid, Option<String>, String, Option<String>)>(
        r#"SELECT u.id, u.display_name, u.email::text, u.avatar_url
           FROM drive.folders f
           JOIN core.users u ON u.id = f.owner_id
           WHERE f.id = $1"#,
    )
    .bind(folder_id)
    .fetch_optional(db)
    .await?;

    Ok(row.map(|(id, display_name, email, avatar_url)| OwnerInfo { id, display_name, email, avatar_url }))
}

// ── Accès (partages internes avec destinataire nommé) ─────────────────────────

pub async fn list_file_access(db: &PgPool, file_id: Uuid) -> crate::errors::Result<Vec<AccessEntry>> {
    let rows = sqlx::query_as::<_, AccessEntry>(
        r#"SELECT s.id as share_id, s.recipient_id, u.display_name, u.email::text as email,
                  u.avatar_url, s.can_download, s.can_upload, s.can_delete,
                  s.expires_at, s.created_at
           FROM drive.shares s
           JOIN core.users u ON u.id = s.recipient_id
           WHERE s.file_id = $1 AND s.recipient_id IS NOT NULL AND s.revoked_at IS NULL
           ORDER BY s.created_at DESC"#,
    )
    .bind(file_id)
    .fetch_all(db)
    .await?;
    Ok(rows)
}

pub async fn list_folder_access(db: &PgPool, folder_id: Uuid) -> crate::errors::Result<Vec<AccessEntry>> {
    let rows = sqlx::query_as::<_, AccessEntry>(
        r#"SELECT s.id as share_id, s.recipient_id, u.display_name, u.email::text as email,
                  u.avatar_url, s.can_download, s.can_upload, s.can_delete,
                  s.expires_at, s.created_at
           FROM drive.shares s
           JOIN core.users u ON u.id = s.recipient_id
           WHERE s.folder_id = $1 AND s.recipient_id IS NOT NULL AND s.revoked_at IS NULL
           ORDER BY s.created_at DESC"#,
    )
    .bind(folder_id)
    .fetch_all(db)
    .await?;
    Ok(rows)
}

// ── Unused import guard ───────────────────────────────────────────────────────
#[allow(dead_code)]
#[derive(Deserialize)]
pub struct _Unused {}
