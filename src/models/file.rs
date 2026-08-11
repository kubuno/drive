use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct File {
    pub id:            Uuid,
    pub owner_id:      Uuid,
    pub folder_id:     Option<Uuid>,
    pub name:          String,
    pub extension:     Option<String>,
    pub mime_type:     String,
    pub size_bytes:    i64,
    pub storage_path:  String,
    pub content_hash:  Option<String>,
    pub metadata:      serde_json::Value,
    pub is_starred:    bool,
    pub is_protected:  bool,
    pub is_trashed:    bool,
    pub trashed_at:    Option<DateTime<Utc>>,
    pub has_thumbnail:      bool,
    pub versioning_enabled: bool,
    pub created_at:         DateTime<Utc>,
    pub updated_at:         DateTime<Utc>,

    /// Number of revisions kept for this file, the current content excluded.
    ///
    /// Only the listing and the file detail compute it (see
    /// [`crate::services::files::VERSION_STATS_JOIN`]); every other query
    /// selecting a `File` leaves it at zero rather than paying for a join it
    /// has no use for.
    #[sqlx(default)]
    pub version_count: i64,
    /// Total bytes held by those revisions. Same origin as `version_count`.
    #[sqlx(default)]
    pub version_bytes: i64,
}

#[derive(Debug, Deserialize)]
pub struct UploadFileDto {
    pub folder_id: Option<Uuid>,
    pub name:      Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MoveFileDto {
    pub folder_id: Option<Uuid>,
    /// Si true, écrase le fichier existant portant le même nom dans la destination.
    /// Si false (défaut), renomme avec numérotation.
    #[serde(default)]
    pub overwrite: bool,
    /// Si true et qu'il y a un conflit, retourne HTTP 409 au lieu d'auto-renommer.
    #[serde(default)]
    pub strict: bool,
}

#[derive(Debug, Deserialize)]
pub struct RenameFileDto {
    pub name: String,
    /// Si true, écrase le fichier existant portant le même nom.
    #[serde(default)]
    pub overwrite: bool,
    /// Si true et qu'il y a un conflit, retourne HTTP 409 au lieu d'auto-renommer.
    /// Utilisé par les opérations initiées par l'utilisateur dans les dossiers partagés.
    #[serde(default)]
    pub strict: bool,
}

#[derive(Debug, Deserialize, Default)]
pub struct ListFilesQuery {
    pub folder_id:          Option<Uuid>,
    pub folder_path_prefix: Option<String>,
    pub mime_type:          Option<String>,
    pub starred:            Option<bool>,
    pub trashed:            Option<bool>,
    pub recent:             Option<bool>,
    pub search:             Option<String>,
    pub sort_by:            Option<String>,
    pub limit:              Option<i64>,
    pub offset:             Option<i64>,
}
