use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct UploadSession {
    pub id:              Uuid,
    pub owner_id:        Uuid,
    pub folder_id:       Option<Uuid>,
    pub filename:        String,
    pub mime_type:       String,
    pub total_size:      i64,
    pub chunk_size:      i64,
    pub total_chunks:    i32,
    pub chunks_received: i32,
    pub status:          String,
    pub error:           Option<String>,
    pub file_id:         Option<Uuid>,
    pub temp_path:       String,
    pub overwrite:       bool,
    pub expires_at:      DateTime<Utc>,
    pub created_at:      DateTime<Utc>,
    pub updated_at:      DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct InitUploadDto {
    pub folder_id:    Option<Uuid>,
    pub filename:     String,
    pub mime_type:    Option<String>,
    pub total_size:   i64,
    pub chunk_size:   i64,
    /// Si true, écrase le fichier existant portant le même nom à la fin de l'upload.
    #[serde(default)]
    pub overwrite:    bool,
}
