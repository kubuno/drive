use crate::config::Settings;
use kubuno_storage::StorageBackend;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub db:       PgPool,
    pub settings: Arc<Settings>,
    pub storage:  Arc<dyn StorageBackend>,
}
