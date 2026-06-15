use anyhow::Result;
use reqwest::Client;
use serde_json::{json, Value};

/// Publie un event vers le core via POST /internal/events/publish
pub async fn publish_event(
    client: &Client,
    core_url: &str,
    internal_secret: &str,
    event: Value,
) -> Result<()> {
    let url = format!("{core_url}/internal/events/publish");
    client
        .post(&url)
        .header("X-Internal-Secret", internal_secret)
        .json(&event)
        .send()
        .await?;
    Ok(())
}

/// Construit un event FileUploaded
pub fn file_uploaded_event(
    file_id: uuid::Uuid,
    user_id: uuid::Uuid,
    mime_type: &str,
    size_bytes: i64,
) -> Value {
    json!({
        "type": "FileUploaded",
        "payload": {
            "file_id":    file_id,
            "user_id":    user_id,
            "mime_type":  mime_type,
            "size_bytes": size_bytes,
            "module_id":  "drive"
        }
    })
}

/// Construit un event FileDeleted
pub fn file_deleted_event(file_id: uuid::Uuid, user_id: uuid::Uuid) -> Value {
    json!({
        "type": "FileDeleted",
        "payload": {
            "file_id":   file_id,
            "user_id":   user_id,
            "module_id": "drive"
        }
    })
}
