use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Folder {
    pub id:         Uuid,
    pub owner_id:   Uuid,
    pub parent_id:  Option<Uuid>,
    pub name:       String,
    pub path:       String,
    pub is_starred:         bool,
    pub versioning_enabled: bool,
    pub is_protected:       bool,
    pub is_hidden:          bool,
    pub is_trashed:         bool,
    pub trashed_at:         Option<DateTime<Utc>>,
    pub color:              Option<String>,
    pub icon:               Option<String>,
    pub created_at:         DateTime<Utc>,
    pub updated_at:         DateTime<Utc>,
}

/// Ancêtre simplifié pour le fil d'ariane (root → parent immédiat).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct FolderAncestor {
    pub id:   Uuid,
    pub name: String,
}

/// Dossier avec sa taille récursive (somme des fichiers du dossier et descendants).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct FolderSize {
    pub id:         Uuid,
    pub name:       String,
    pub path:       String,
    pub total_size: i64,
    pub file_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateFolderDto {
    pub parent_id: Option<Uuid>,
    pub name:      String,
}

#[derive(Debug, Deserialize)]
pub struct RenameFolderDto {
    pub name: String,
    /// Si true et qu'un dossier portant ce nom existe déjà au même niveau,
    /// fusionne le contenu des deux dossiers.
    #[serde(default)]
    pub overwrite: bool,
    /// Si true et qu'il y a un conflit, retourne HTTP 409 au lieu d'auto-renommer.
    #[serde(default)]
    pub strict: bool,
}

#[derive(Debug, Deserialize)]
pub struct MoveFolderDto {
    pub parent_id: Option<Uuid>,
    /// Si true et qu'un dossier portant le même nom existe dans la destination,
    /// fusionne le contenu des deux dossiers.
    #[serde(default)]
    pub overwrite: bool,
    /// Si true et qu'il y a un conflit, retourne HTTP 409 au lieu d'auto-renommer.
    #[serde(default)]
    pub strict: bool,
}

#[derive(Debug, Deserialize)]
pub struct SetFolderColorDto {
    pub color: Option<String>,
}
