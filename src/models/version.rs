use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct FileVersion {
    pub id:             Uuid,
    pub file_id:        Uuid,
    pub owner_id:       Uuid,
    pub version_number: i32,
    pub storage_path:   String,
    pub size_bytes:     i64,
    pub content_hash:   Option<String>,
    pub comment:        Option<String>,
    pub created_at:     DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateVersionDto {
    pub comment: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SetVersioningDto {
    pub enabled: bool,
}
