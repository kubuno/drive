//! Platform fonts shipped WITH the drive module.
//!
//! The two default faces of the platform (Google Sans Flex, Roboto Flex) are
//! embedded in the binary and seeded into the shared `System/Fonts` directory
//! at startup, marked `is_protected` so nobody — administrators included — can
//! delete them. The core's stylesheet then loads them from THIS instance
//! (`/api/v1/drive/fonts/css2`, see [`crate::handlers::fonts`]) instead of a
//! third-party CDN.

use bytes::Bytes;
use kubuno_storage::StorageBackend;
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

use crate::{errors::Result, handlers::system::SYSTEM_OWNER, services::files};

/// `System/Fonts` folder, created by migration `000018_drive_system`.
pub const FONTS_FOLDER_ID: Uuid = Uuid::from_u128(0x5a2);

macro_rules! font_asset {
    ($file:literal) => {
        include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/fonts/", $file))
    };
}

/// (file name in System/Fonts, embedded bytes). All OFL-licensed. Google Sans
/// Flex / Roboto Flex / Inter are full variable fonts, DM Mono ships as its
/// six static styles (the family has no variable release). The internal `name`
/// table carries the family that the css2 endpoint and the Fonts explorer
/// match against.
const EMBEDDED_FONTS: &[(&str, &[u8])] = &[
    // The platform's default stack: "Google Sans Text", "Google Sans", Roboto.
    // Google Sans Text has no variable release → its six static styles.
    ("Google Sans Text Regular.ttf", font_asset!("GoogleSansText-Regular.ttf")),
    ("Google Sans Text Italic.ttf", font_asset!("GoogleSansText-Italic.ttf")),
    ("Google Sans Text Medium.ttf", font_asset!("GoogleSansText-Medium.ttf")),
    ("Google Sans Text Medium Italic.ttf", font_asset!("GoogleSansText-MediumItalic.ttf")),
    ("Google Sans Text Bold.ttf", font_asset!("GoogleSansText-Bold.ttf")),
    ("Google Sans Text Bold Italic.ttf", font_asset!("GoogleSansText-BoldItalic.ttf")),
    ("Google Sans.ttf", font_asset!("GoogleSans.ttf")),
    ("Google Sans Italic.ttf", font_asset!("GoogleSans-Italic.ttf")),
    ("Roboto.ttf", font_asset!("Roboto.ttf")),
    ("Roboto Italic.ttf", font_asset!("Roboto-Italic.ttf")),
    // Kept available (pickers, documents that already use them).
    ("Google Sans Flex.ttf", font_asset!("GoogleSansFlex.ttf")),
    ("Roboto Flex.ttf", font_asset!("RobotoFlex.ttf")),
    ("Inter.ttf", font_asset!("InterVariable.ttf")),
    ("Inter Italic.ttf", font_asset!("InterVariable-Italic.ttf")),
    ("DM Mono Light.ttf", font_asset!("DMMono-Light.ttf")),
    ("DM Mono Light Italic.ttf", font_asset!("DMMono-LightItalic.ttf")),
    ("DM Mono Regular.ttf", font_asset!("DMMono-Regular.ttf")),
    ("DM Mono Italic.ttf", font_asset!("DMMono-Italic.ttf")),
    ("DM Mono Medium.ttf", font_asset!("DMMono-Medium.ttf")),
    ("DM Mono Medium Italic.ttf", font_asset!("DMMono-MediumItalic.ttf")),
];

/// Idempotent: uploads each embedded font that System/Fonts does not already
/// hold (matched by file name), (re)asserts `is_protected` on those it does,
/// and refreshes IN PLACE any whose bytes drifted from the embedded ones —
/// protected files cannot be replaced through the API, administrators
/// included, so a corrected binary can only ever arrive through here.
pub async fn seed(db: &PgPool, storage: &Arc<dyn StorageBackend>) -> Result<()> {
    for (name, bytes) in EMBEDDED_FONTS {
        let existing: Option<(Uuid, bool)> = sqlx::query_as(
            "SELECT id, is_protected FROM drive.files
             WHERE owner_id = $1 AND folder_id = $2 AND name = $3 AND is_trashed = FALSE",
        )
        .bind(SYSTEM_OWNER)
        .bind(FONTS_FOLDER_ID)
        .bind(name)
        .fetch_optional(db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, name, "System font lookup failed");
            e
        })?;

        match existing {
            Some((id, true)) => {
                refresh_bytes(db, storage, id, name, bytes).await?;
            }
            Some((id, false)) => {
                sqlx::query("UPDATE drive.files SET is_protected = TRUE WHERE id = $1")
                    .bind(id)
                    .execute(db)
                    .await
                    .map_err(|e| {
                        tracing::error!(error = %e, name, "System font re-protection failed");
                        e
                    })?;
                refresh_bytes(db, storage, id, name, bytes).await?;
                tracing::info!(name, "System font re-protected");
            }
            None => {
                let file = files::upload_simple(
                    db,
                    storage,
                    SYSTEM_OWNER,
                    Some(FONTS_FOLDER_ID),
                    name,
                    Bytes::from_static(bytes),
                    u64::MAX,
                    false,
                )
                .await?;
                sqlx::query("UPDATE drive.files SET is_protected = TRUE WHERE id = $1")
                    .bind(file.id)
                    .execute(db)
                    .await
                    .map_err(|e| {
                        tracing::error!(error = %e, name, "System font protection failed");
                        e
                    })?;
                tracing::info!(name, id = %file.id, "System font installed into System/Fonts");
            }
        }
    }
    Ok(())
}

/// Rewrites a seeded font's bytes when the embedded binary changed (compared
/// by content hash). Same storage path, same row id: everything pointing at
/// the file (css2 URLs, embeds) keeps working, and `updated_at` moving is what
/// invalidates the css2 parser cache.
async fn refresh_bytes(
    db: &PgPool,
    storage: &Arc<dyn StorageBackend>,
    id: Uuid,
    name: &str,
    bytes: &'static [u8],
) -> Result<()> {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let embedded_hash = hex::encode(hasher.finalize());

    let row: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT storage_path, content_hash FROM drive.files WHERE id = $1")
            .bind(id)
            .fetch_optional(db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, name, "System font read for refresh failed");
                e
            })?;
    let Some((storage_path, current_hash)) = row else { return Ok(()) };
    if current_hash.as_deref() == Some(embedded_hash.as_str()) {
        return Ok(());
    }

    storage.put(&storage_path, Bytes::from_static(bytes)).await?;
    sqlx::query(
        "UPDATE drive.files SET size_bytes = $2, content_hash = $3, updated_at = NOW() WHERE id = $1",
    )
    .bind(id)
    .bind(bytes.len() as i64)
    .bind(&embedded_hash)
    .execute(db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, name, "System font refresh failed");
        e
    })?;
    tracing::info!(name, id = %id, "System font refreshed in place");
    Ok(())
}
