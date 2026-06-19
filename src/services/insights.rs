//! Content intelligence: EXIF/image metadata extraction, duplicate detection
//! (by content hash) and a storage overview for dashboards.

use std::io::Cursor;

use serde::Serialize;
use serde_json::{json, Map, Value};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{errors::Result, models::File};

// ── Image / EXIF metadata ─────────────────────────────────────────────────────

/// Reads pixel dimensions from an image's header without fully decoding it.
pub fn image_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    image::ImageReader::new(Cursor::new(data))
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()
}

/// One GPS coordinate (degrees/minutes/seconds → signed decimal) from EXIF.
fn gps_decimal(exif: &exif::Exif, coord: exif::Tag, reference: exif::Tag) -> Option<f64> {
    let field = exif.get_field(coord, exif::In::PRIMARY)?;
    if let exif::Value::Rational(ref v) = field.value {
        if v.len() >= 3 {
            let mut dec = v[0].to_f64() + v[1].to_f64() / 60.0 + v[2].to_f64() / 3600.0;
            if let Some(r) = exif.get_field(reference, exif::In::PRIMARY) {
                let rs = r.display_value().to_string();
                if rs.contains('S') || rs.contains('W') {
                    dec = -dec;
                }
            }
            return Some(dec);
        }
    }
    None
}

/// Extracts a compact set of EXIF fields (best-effort; empty when absent).
pub fn extract_exif(data: &[u8]) -> Value {
    let mut out = Map::new();
    let mut cursor = Cursor::new(data);
    let reader = exif::Reader::new();
    let Ok(exif) = reader.read_from_container(&mut cursor) else {
        return Value::Object(out);
    };

    let pick = |tag: exif::Tag| -> Option<String> {
        exif.get_field(tag, exif::In::PRIMARY)
            .map(|f| f.display_value().with_unit(&exif).to_string())
    };

    let fields: [(&str, exif::Tag); 9] = [
        ("camera_make",    exif::Tag::Make),
        ("camera_model",   exif::Tag::Model),
        ("lens_model",     exif::Tag::LensModel),
        ("taken_at",       exif::Tag::DateTimeOriginal),
        ("orientation",    exif::Tag::Orientation),
        ("exposure_time",  exif::Tag::ExposureTime),
        ("f_number",       exif::Tag::FNumber),
        ("iso",            exif::Tag::PhotographicSensitivity),
        ("focal_length",   exif::Tag::FocalLength),
    ];
    for (key, tag) in fields {
        if let Some(v) = pick(tag) {
            out.insert(key.to_string(), Value::String(v));
        }
    }

    if let (Some(lat), Some(lon)) = (
        gps_decimal(&exif, exif::Tag::GPSLatitude, exif::Tag::GPSLatitudeRef),
        gps_decimal(&exif, exif::Tag::GPSLongitude, exif::Tag::GPSLongitudeRef),
    ) {
        out.insert("gps".into(), json!({ "lat": lat, "lon": lon }));
    }

    Value::Object(out)
}

// ── Duplicate detection ───────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct DuplicateGroup {
    pub content_hash: String,
    pub count:        usize,
    /// Reclaimable space if all but one copy were removed.
    pub wasted_bytes: i64,
    pub files:        Vec<File>,
}

/// Groups the user's non-trashed files that share a content hash.
pub async fn find_duplicates(db: &PgPool, owner_id: Uuid) -> Result<Vec<DuplicateGroup>> {
    let files = sqlx::query_as::<_, File>(
        "SELECT f.* FROM drive.files f
         WHERE f.owner_id = $1 AND f.is_trashed = FALSE AND f.content_hash IS NOT NULL
           AND f.content_hash IN (
                SELECT content_hash FROM drive.files
                WHERE owner_id = $1 AND is_trashed = FALSE AND content_hash IS NOT NULL
                GROUP BY content_hash HAVING COUNT(*) > 1)
         ORDER BY f.content_hash, f.created_at ASC",
    )
    .bind(owner_id)
    .fetch_all(db)
    .await?;

    let mut groups: Vec<DuplicateGroup> = Vec::new();
    for file in files {
        let hash = file.content_hash.clone().unwrap_or_default();
        match groups.last_mut() {
            Some(g) if g.content_hash == hash => {
                g.count += 1;
                g.wasted_bytes += file.size_bytes;
                g.files.push(file);
            }
            _ => groups.push(DuplicateGroup {
                content_hash: hash,
                count: 1,
                wasted_bytes: 0, // first copy is "kept", not wasted
                files: vec![file],
            }),
        }
    }
    // Largest reclaimable space first; drop accidental singletons.
    groups.retain(|g| g.count > 1);
    groups.sort_by(|a, b| b.wasted_bytes.cmp(&a.wasted_bytes));
    Ok(groups)
}

// ── Storage overview ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CategoryStat {
    pub category: String,
    pub count:    i64,
    pub size:     i64,
}

/// A by-category breakdown plus headline totals, for the storage dashboard.
pub async fn storage_overview(db: &PgPool, owner_id: Uuid) -> Result<Value> {
    let categories = sqlx::query_as::<_, CategoryStat>(
        "SELECT
            CASE
                WHEN mime_type LIKE 'image/%' THEN 'image'
                WHEN mime_type LIKE 'video/%' THEN 'video'
                WHEN mime_type LIKE 'audio/%' THEN 'audio'
                WHEN mime_type LIKE 'application/pdf' THEN 'document'
                WHEN mime_type LIKE 'text/%' THEN 'document'
                WHEN mime_type LIKE '%zip%' OR mime_type LIKE '%tar%' OR mime_type LIKE '%gzip%' THEN 'archive'
                ELSE 'other'
            END AS category,
            COUNT(*) AS count,
            COALESCE(SUM(size_bytes), 0)::BIGINT AS size
         FROM drive.files
         WHERE owner_id = $1 AND is_trashed = FALSE
         GROUP BY category",
    )
    .bind(owner_id)
    .fetch_all(db)
    .await?;

    let total_files: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM drive.files WHERE owner_id = $1 AND is_trashed = FALSE",
    )
    .bind(owner_id)
    .fetch_one(db)
    .await?;

    let total_folders: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM drive.folders WHERE owner_id = $1 AND is_trashed = FALSE AND is_hidden = FALSE",
    )
    .bind(owner_id)
    .fetch_one(db)
    .await?;

    let trashed_files: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM drive.files WHERE owner_id = $1 AND is_trashed = TRUE",
    )
    .bind(owner_id)
    .fetch_one(db)
    .await?;

    let largest = sqlx::query_as::<_, File>(
        "SELECT * FROM drive.files
         WHERE owner_id = $1 AND is_trashed = FALSE
         ORDER BY size_bytes DESC LIMIT 10",
    )
    .bind(owner_id)
    .fetch_all(db)
    .await?;

    Ok(json!({
        "categories":    categories,
        "total_files":   total_files,
        "total_folders": total_folders,
        "trashed_files": trashed_files,
        "largest":       largest,
    }))
}
