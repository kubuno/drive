use std::sync::{Arc, OnceLock};
use std::time::Duration;

use anyhow::Result;
use reqwest::Client;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::config::Settings;

/// Shared HTTP client for fire-and-forget notifications to the core.
fn notify_http() -> &'static Client {
    static C: OnceLock<Client> = OnceLock::new();
    C.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_default()
    })
}

/// Notifies the core that the user's drive changed, so connected clients
/// (desktop daemon, mobile apps) pull immediately instead of waiting for a poll.
///
/// Sent as a `Custom` event targeted at the owner (`recipient_user_ids`), so the
/// core's WebSocket routes it only to that user. Fire-and-forget: a failed
/// notification never blocks or fails the originating request.
pub fn notify_change(settings: &Arc<Settings>, owner_id: Uuid) {
    let core_url = settings.core.url.clone();
    let secret = settings.core.internal_secret.clone();
    let event = json!({
        "type": "Custom",
        "payload": {
            "event_type": "drive.changed",
            "module_id":  "drive",
            "payload": { "recipient_user_ids": [owner_id] }
        }
    });
    tokio::spawn(async move {
        let _ = notify_http()
            .post(format!("{core_url}/internal/events/publish"))
            .header("X-Internal-Secret", secret)
            .json(&event)
            .send()
            .await;
    });
}

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
