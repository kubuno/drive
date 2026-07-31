use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A comment anchored to a rectangular region of a document page.
/// Coordinates are normalized to [0,1] relative to the page box.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct PdfComment {
    pub id:          Uuid,
    pub file_id:     Uuid,
    pub author_id:   Uuid,
    pub author_name: Option<String>,
    pub page:        i32,
    pub x:           f64,
    pub y:           f64,
    pub w:           f64,
    pub h:           f64,
    pub body:        String,
    pub resolved:    bool,
    pub created_at:  DateTime<Utc>,
    pub updated_at:  DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreatePdfCommentDto {
    pub page: i32,
    pub x:    f64,
    pub y:    f64,
    pub w:    f64,
    pub h:    f64,
    pub body: String,
}
