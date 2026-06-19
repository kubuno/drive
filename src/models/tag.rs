use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A colored label owned by a user.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Tag {
    pub id:         Uuid,
    pub owner_id:   Uuid,
    pub name:       String,
    pub color:      String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A tag enriched with how many items (files + folders) carry it.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct TagWithCount {
    pub id:         Uuid,
    pub owner_id:   Uuid,
    pub name:       String,
    pub color:      String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub item_count: i64,
}

/// One tag↔item link, used to paint badges on cards without enriching listings.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct TagAssignment {
    pub tag_id:  Uuid,
    pub item_id: Uuid,
    /// "file" | "folder"
    pub kind:    String,
}

#[derive(Debug, Deserialize)]
pub struct CreateTagDto {
    pub name:  String,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTagDto {
    pub name:  Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AssignTagDto {
    pub tag_id: Uuid,
}
