use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

/// Access counters for a single file.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct FileAccess {
    pub file_id:            Uuid,
    pub owner_id:           Uuid,
    pub view_count:         i64,
    pub download_count:     i64,
    pub last_viewed_at:     Option<DateTime<Utc>>,
    pub last_downloaded_at: Option<DateTime<Utc>>,
}

/// A frequently-used file, enriched for the "Fréquents" view.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct FrequentFile {
    pub file_id:        Uuid,
    pub name:           String,
    pub mime_type:      String,
    pub has_thumbnail:  bool,
    pub view_count:     i64,
    pub last_viewed_at: Option<DateTime<Utc>>,
}

/// A recently-opened file (centralised log) — the full file row plus which app
/// opened it and when (flattened so the JSON is a `File` with two extra fields).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct RecentFile {
    #[serde(flatten)]
    #[sqlx(flatten)]
    pub file:      super::file::File,
    pub module_id: String,
    pub opened_at: DateTime<Utc>,
}
