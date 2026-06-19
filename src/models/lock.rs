use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A cooperative lock held on a file.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct FileLock {
    pub file_id:    Uuid,
    pub locked_by:  Uuid,
    pub reason:     Option<String>,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}

/// A lock enriched with the holder's display name, for badges and tooltips.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct FileLockInfo {
    pub file_id:        Uuid,
    pub locked_by:      Uuid,
    pub locked_by_name: Option<String>,
    pub reason:         Option<String>,
    pub created_at:     DateTime<Utc>,
    pub expires_at:     Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct LockFileDto {
    pub reason: Option<String>,
}
