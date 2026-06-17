use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum FilesError {
    #[error("Non authentifié")]
    Unauthorized,

    #[error("Accès refusé")]
    Forbidden,

    #[error("Ressource introuvable: {0}")]
    NotFound(String),

    #[error("Données invalides: {0}")]
    Validation(String),

    #[error("Conflit: {0}")]
    Conflict(String),

    #[error("Précondition échouée: {0}")]
    PreconditionFailed(String),

    #[error("{0}")]
    Protected(String),

    #[error("Quota dépassé")]
    QuotaExceeded,

    #[error("Fichier trop volumineux")]
    FileTooLarge,

    #[error("Upload expiré ou introuvable")]
    UploadNotFound,

    #[error("Erreur de stockage: {0}")]
    Storage(#[from] kubuno_storage::StorageError),

    #[error("Erreur base de données")]
    Database(#[from] sqlx::Error),

    #[error("Erreur connecteur distant: {0}")]
    Remote(String),

    #[error("Erreur interne")]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for FilesError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            FilesError::Unauthorized    => (StatusCode::UNAUTHORIZED,           "UNAUTHORIZED",    self.to_string()),
            FilesError::Forbidden       => (StatusCode::FORBIDDEN,              "FORBIDDEN",       self.to_string()),
            FilesError::NotFound(_)     => (StatusCode::NOT_FOUND,              "NOT_FOUND",       self.to_string()),
            FilesError::Validation(_)   => (StatusCode::UNPROCESSABLE_ENTITY,   "VALIDATION",      self.to_string()),
            FilesError::Conflict(_)     => (StatusCode::CONFLICT,               "CONFLICT",        self.to_string()),
            FilesError::PreconditionFailed(_) => (StatusCode::PRECONDITION_FAILED, "PRECONDITION_FAILED", self.to_string()),
            FilesError::Protected(_)    => (StatusCode::CONFLICT,               "PROTECTED",       self.to_string()),
            FilesError::QuotaExceeded   => (StatusCode::from_u16(507).unwrap(), "QUOTA_EXCEEDED",  self.to_string()),
            FilesError::FileTooLarge    => (StatusCode::PAYLOAD_TOO_LARGE,      "FILE_TOO_LARGE",  self.to_string()),
            FilesError::UploadNotFound  => (StatusCode::NOT_FOUND,              "UPLOAD_NOT_FOUND",self.to_string()),
            FilesError::Storage(e) => {
                tracing::error!(error = %e, "Storage error");
                (StatusCode::INTERNAL_SERVER_ERROR, "STORAGE_ERROR", "Erreur de stockage".to_string())
            }
            FilesError::Database(e) => {
                tracing::error!(error = %e, "Database error");
                (StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", "Erreur base de données".to_string())
            }
            FilesError::Remote(e) => {
                tracing::error!(error = %e, "Remote connector error");
                (StatusCode::BAD_GATEWAY, "REMOTE_ERROR", format!("Erreur distante: {e}"))
            }
            FilesError::Internal(e) => {
                tracing::error!(error = %e, "Internal error");
                (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Erreur interne".to_string())
            }
        };

        (status, Json(json!({ "error": code, "message": message }))).into_response()
    }
}

pub type Result<T> = std::result::Result<T, FilesError>;
