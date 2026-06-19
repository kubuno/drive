use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Share {
    pub id:             Uuid,
    pub owner_id:       Uuid,
    pub file_id:        Option<Uuid>,
    pub folder_id:      Option<Uuid>,
    pub token:          Option<String>,
    pub recipient_id:   Option<Uuid>,
    pub can_download:   bool,
    pub can_upload:     bool,
    pub can_delete:     bool,
    pub password_hash:  Option<String>,
    pub expires_at:     Option<DateTime<Utc>>,
    pub download_count: i32,
    pub max_downloads:  Option<i32>,
    pub created_at:     DateTime<Utc>,
    pub updated_at:     DateTime<Utc>,
    pub revoked_at:     Option<DateTime<Utc>>,
}

/// Un partage enrichi du nom de l'élément cible, de son type et — pour les
/// partages reçus — du nom du propriétaire. Le hash de mot de passe n'est jamais
/// exposé : seul le booléen `password_protected` l'est.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ShareWithTarget {
    pub id:                 Uuid,
    pub owner_id:           Uuid,
    pub file_id:            Option<Uuid>,
    pub folder_id:          Option<Uuid>,
    pub token:              Option<String>,
    pub recipient_id:       Option<Uuid>,
    pub can_download:       bool,
    pub can_upload:         bool,
    pub can_delete:         bool,
    pub password_protected: bool,
    pub expires_at:         Option<DateTime<Utc>>,
    pub download_count:     i32,
    pub max_downloads:      Option<i32>,
    pub created_at:         DateTime<Utc>,
    pub updated_at:         DateTime<Utc>,
    pub revoked_at:         Option<DateTime<Utc>>,
    pub item_name:          Option<String>,
    pub item_kind:          String,
    pub owner_name:         Option<String>,
}

/// Résultat de recherche d'un destinataire potentiel (partage interne).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct RecipientHit {
    pub id:           Uuid,
    pub display_name: Option<String>,
    pub email:        String,
    pub avatar_url:   Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateShareDto {
    pub file_id:       Option<Uuid>,
    pub folder_id:     Option<Uuid>,
    pub recipient_id:  Option<Uuid>,
    pub can_download:  Option<bool>,
    pub can_upload:    Option<bool>,
    pub can_delete:    Option<bool>,
    pub password:      Option<String>,
    pub expires_at:    Option<DateTime<Utc>>,
    pub max_downloads: Option<i32>,
}
