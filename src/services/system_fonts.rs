//! Platform fonts shipped WITH the drive module.
//!
//! The platform's own face (Outfit) is embedded in the binary and seeded into
//! the shared `System/Fonts` directory at startup, marked `is_protected` so
//! nobody — administrators included — can delete it. The core's stylesheet then
//! loads it from THIS instance (`/api/v1/drive/fonts/css2`, see
//! [`crate::handlers::fonts`]) instead of a third-party CDN.
//!
//! Every embedded face is under a licence that allows redistribution, and the
//! licence text ships beside it (`assets/fonts/*-OFL.txt`) as the SIL Open Font
//! License requires. A font this product cannot redistribute has no business
//! being compiled into a binary that is packaged and published.

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

/// (file name in System/Fonts, embedded bytes). All OFL-licensed. Outfit /
/// Roboto Flex / Inter are full variable fonts; DM Mono ships as its six static
/// styles (the family has no variable release). The internal `name` table
/// carries the family that the css2 endpoint and the Fonts explorer match
/// against.
const EMBEDDED_FONTS: &[(&str, &[u8])] = &[
    // The platform's own face. Outfit is a single variable file covering the
    // whole 100..900 weight range, which is why one entry replaces the ten
    // static and variable files the previous default stack needed.
    ("Outfit.ttf", font_asset!("Outfit.ttf")),
    ("Roboto.ttf", font_asset!("Roboto.ttf")),
    ("Roboto Italic.ttf", font_asset!("Roboto-Italic.ttf")),
    // Kept available (pickers, documents that already use them).
    // Plus Jakarta Sans ships both cuts because it HAS a real italic, unlike
    // Outfit — a document set in it gets a drawn oblique rather than one the
    // browser slants itself.
    ("Plus Jakarta Sans.ttf", font_asset!("PlusJakartaSans.ttf")),
    ("Plus Jakarta Sans Italic.ttf", font_asset!("PlusJakartaSans-Italic.ttf")),
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

/// Faces this module used to ship and no longer does.
///
/// Seeding alone cannot undo itself: it never deletes, and what it installed is
/// `is_protected`, which the API refuses to remove — administrators included.
/// So an instance that was seeded with a font we have since dropped would keep
/// serving it for ever, and the whole point of dropping it would be lost. These
/// names are actively removed at startup.
///
/// The Google Sans families were retired in favour of Outfit: this product is a
/// sovereign alternative to Google Workspace, and shipping Google's own
/// typeface in it was incoherent — quite apart from the six `Google Sans Text`
/// files whose licence metadata was empty, which is not something to redistribute
/// in a package.
const RETIRED_FONTS: &[&str] = &[
    "Google Sans Text Regular.ttf",
    "Google Sans Text Italic.ttf",
    "Google Sans Text Medium.ttf",
    "Google Sans Text Medium Italic.ttf",
    "Google Sans Text Bold.ttf",
    "Google Sans Text Bold Italic.ttf",
    "Google Sans.ttf",
    "Google Sans Italic.ttf",
    "Google Sans Flex.ttf",
];

/// Removes the faces listed in [`RETIRED_FONTS`] from `System/Fonts`.
///
/// Un-protects first, because permanent deletion refuses a protected file by
/// design. Failures are logged and skipped rather than propagated: a font that
/// resists removal must not keep the module from starting.
async fn retire_dropped_fonts(db: &PgPool, storage: &Arc<dyn StorageBackend>) {
    for name in RETIRED_FONTS {
        let existing: std::result::Result<Option<(Uuid,)>, _> = sqlx::query_as(
            "SELECT id FROM drive.files
             WHERE owner_id = $1 AND folder_id = $2 AND name = $3 AND is_trashed = FALSE",
        )
        .bind(SYSTEM_OWNER)
        .bind(FONTS_FOLDER_ID)
        .bind(name)
        .fetch_optional(db)
        .await;

        let Ok(Some((id,))) = existing else { continue };

        if let Err(e) = sqlx::query("UPDATE drive.files SET is_protected = FALSE WHERE id = $1")
            .bind(id)
            .execute(db)
            .await
        {
            tracing::warn!(error = %e, name, "Retired font could not be un-protected");
            continue;
        }
        match files::delete_file_permanently(db, storage, SYSTEM_OWNER, id).await {
            Ok(()) => tracing::info!(name, "Retired font removed from System/Fonts"),
            Err(e) => tracing::warn!(error = %e, name, "Retired font could not be removed"),
        }
    }
}

/// Idempotent: removes the faces this module no longer ships, uploads each
/// embedded font that System/Fonts does not already hold (matched by file
/// name), (re)asserts `is_protected` on those it does, and refreshes IN PLACE
/// any whose bytes drifted from the embedded ones — protected files cannot be
/// replaced through the API, administrators included, so a corrected binary can
/// only ever arrive through here.
pub async fn seed(db: &PgPool, storage: &Arc<dyn StorageBackend>) -> Result<()> {
    retire_dropped_fonts(db, storage).await;

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
