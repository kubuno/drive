use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A named, persisted query ("smart folder") the user can recall from the sidebar.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct SavedSearch {
    pub id:         Uuid,
    pub owner_id:   Uuid,
    pub name:       String,
    pub query:      String,
    pub filters:    serde_json::Value,
    pub icon:       Option<String>,
    pub color:      Option<String>,
    pub position:   i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSavedSearchDto {
    pub name:    String,
    pub query:   Option<String>,
    pub filters: Option<serde_json::Value>,
    pub icon:    Option<String>,
    pub color:   Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSavedSearchDto {
    pub name:     Option<String>,
    pub query:    Option<String>,
    pub filters:  Option<serde_json::Value>,
    pub icon:     Option<String>,
    pub color:    Option<String>,
    pub position: Option<i32>,
}
