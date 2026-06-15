use axum::{
    extract::{Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::Result,
    services::scanner,
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct ScanQuery {
    pub owner_id: Option<Uuid>,
}

pub async fn scan(
    State(state): State<AppState>,
    Query(query): Query<ScanQuery>,
) -> Result<Json<Value>> {
    let storage_base = std::path::PathBuf::from(state.settings.storage.local_path());

    let stats = if let Some(owner_id) = query.owner_id {
        scanner::scan_owner(&state.db, &storage_base, owner_id).await?
    } else {
        scanner::scan_all(&state.db, &storage_base).await?
    };

    Ok(Json(json!({
        "scan": {
            "folders_added":  stats.folders_added,
            "files_added":    stats.files_added,
            "files_updated":  stats.files_updated,
            "files_removed":  stats.files_removed,
        }
    })))
}
