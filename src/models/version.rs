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

/// What purging a file's history actually gave back — the two figures the
/// interface promised before asking for confirmation.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct VersionsPurgeResult {
    /// Revisions deleted.
    pub removed:     i64,
    /// Bytes returned to the account's quota.
    pub freed_bytes: i64,
}

/// Account-wide weight of the version histories, for the storage screens.
#[derive(Debug, Clone, Copy, Serialize, sqlx::FromRow)]
pub struct VersionsSummary {
    /// Files carrying at least one stored revision.
    pub files_with_versions: i64,
    /// Stored revisions, all files taken together.
    pub total_versions:      i64,
    /// Bytes those revisions occupy.
    pub total_bytes:         i64,
}
