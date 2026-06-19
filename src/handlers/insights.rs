use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::Result,
    middleware::FilesUser,
    services::{files, insights},
    state::AppState,
};

/// EXIF + pixel dimensions for an image file (best-effort; empty for non-images).
pub async fn metadata_extra(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Path(file_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let file = files::get_file(&state.db, user.id, file_id).await?;
    if !file.mime_type.starts_with("image/") {
        return Ok(Json(json!({ "exif": {}, "width": null, "height": null })));
    }

    let data = state.storage.get(&file.storage_path).await?;
    let (exif, dims) = tokio::task::block_in_place(|| {
        (insights::extract_exif(data.as_ref()), insights::image_dimensions(data.as_ref()))
    });

    Ok(Json(json!({
        "exif":   exif,
        "width":  dims.map(|d| d.0),
        "height": dims.map(|d| d.1),
    })))
}

/// Groups of duplicate files (same content hash) with reclaimable space.
pub async fn duplicates(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
) -> Result<Json<Value>> {
    let groups = insights::find_duplicates(&state.db, user.id).await?;
    let wasted: i64 = groups.iter().map(|g| g.wasted_bytes).sum();
    Ok(Json(json!({ "groups": groups, "total_wasted": wasted })))
}

/// A by-category storage breakdown plus headline totals.
pub async fn overview(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
) -> Result<Json<Value>> {
    let overview = insights::storage_overview(&state.db, user.id).await?;
    Ok(Json(overview))
}
