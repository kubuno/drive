//! Public font serving, in the spirit of the Google Fonts CSS API.
//!
//! `GET /fonts/css2?family=Google+Sans+Flex&family=Roboto+Flex&display=swap`
//! returns `@font-face` rules whose `src` points back to this instance, and
//! `GET /fonts/files/:id` serves the font binaries. Both are UNAUTHENTICATED
//! on purpose: stylesheet and font fetches carry no Authorization header (the
//! login page needs the platform faces too), and the surface only ever exposes
//! files sitting in the shared `System/Fonts` directory — nothing user-private.
//!
//! The `@font-face` descriptors (weight/stretch ranges, family name) are read
//! from the font binaries themselves (`name`, `fvar`, `OS/2` tables), parsed
//! once per file and cached in memory.

use axum::{
    body::Body,
    extract::{Path, RawQuery, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
};
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    handlers::system::SYSTEM_OWNER,
    services::system_fonts::FONTS_FOLDER_ID,
    state::AppState,
};

// ── Minimal SFNT parsing (name / fvar / OS-2) ────────────────────────────────

/// What a `@font-face` rule needs to know about one font file.
#[derive(Debug, Clone, Default)]
struct FontInfo {
    /// Typographic family (name ID 16, falling back to 1).
    family: Option<String>,
    /// `wght` axis range for variable fonts.
    wght: Option<(f32, f32)>,
    /// `wdth` axis range for variable fonts (percent, CSS `font-stretch`).
    wdth: Option<(f32, f32)>,
    /// OS/2 usWeightClass, for static fonts.
    weight_class: u16,
    /// OS/2 fsSelection italic bit.
    italic: bool,
}

fn be16(b: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_be_bytes([*b.get(o)?, *b.get(o + 1)?]))
}

fn be32(b: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_be_bytes([*b.get(o)?, *b.get(o + 1)?, *b.get(o + 2)?, *b.get(o + 3)?]))
}

/// 16.16 fixed-point → f32.
fn fixed(b: &[u8], o: usize) -> Option<f32> {
    Some(be32(b, o)? as i32 as f32 / 65536.0)
}

/// Table directory lookup: `(offset, length)` of a table by tag.
fn find_table(data: &[u8], tag: &[u8; 4]) -> Option<(usize, usize)> {
    let num_tables = be16(data, 4)? as usize;
    for i in 0..num_tables {
        let rec = 12 + i * 16;
        if data.get(rec..rec + 4)? == tag {
            let off = be32(data, rec + 8)? as usize;
            let len = be32(data, rec + 12)? as usize;
            return Some((off, len));
        }
    }
    None
}

/// Family from the `name` table: typographic family (ID 16) beats legacy
/// family (ID 1); Windows/Unicode UTF-16BE records beat Macintosh Latin-1.
fn parse_family(data: &[u8], name_off: usize) -> Option<String> {
    let count = be16(data, name_off + 2)? as usize;
    let strings = name_off + be16(data, name_off + 4)? as usize;
    let mut best: Option<(u8, String)> = None; // (score, value) — higher wins
    for i in 0..count {
        let rec = name_off + 6 + i * 12;
        let platform = be16(data, rec)?;
        let name_id = be16(data, rec + 6)?;
        if name_id != 16 && name_id != 1 {
            continue;
        }
        let len = be16(data, rec + 8)? as usize;
        let off = strings + be16(data, rec + 10)? as usize;
        let raw = data.get(off..off + len)?;
        let value = match platform {
            0 | 3 => {
                // UTF-16BE
                let units: Vec<u16> = raw.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
                String::from_utf16_lossy(&units)
            }
            _ => raw.iter().map(|&b| b as char).collect(),
        };
        let value = value.trim().to_string();
        if value.is_empty() {
            continue;
        }
        let score = (if name_id == 16 { 2 } else { 0 }) + u8::from(platform == 3 || platform == 0);
        if best.as_ref().is_none_or(|(s, _)| score > *s) {
            best = Some((score, value));
        }
    }
    best.map(|(_, v)| v)
}

/// Parse the descriptors out of one font binary. Any structural surprise just
/// degrades to defaults — the CSS still renders, at worst without ranges.
fn parse_font_info(data: &[u8]) -> FontInfo {
    let mut info = FontInfo { weight_class: 400, ..FontInfo::default() };

    if let Some((off, _)) = find_table(data, b"name") {
        info.family = parse_family(data, off);
    }
    if let Some((off, _)) = find_table(data, b"OS/2") {
        if let Some(w) = be16(data, off + 4) {
            if (1..=1000).contains(&w) {
                info.weight_class = w;
            }
        }
        if let Some(fs) = be16(data, off + 62) {
            info.italic = fs & 0x01 != 0;
        }
    }
    if let Some((off, _)) = find_table(data, b"fvar") {
        let axes_off = be16(data, off + 4).map(|v| off + v as usize);
        let count = be16(data, off + 8).unwrap_or(0) as usize;
        let size = be16(data, off + 10).unwrap_or(20) as usize;
        if let Some(base) = axes_off {
            for i in 0..count {
                let a = base + i * size;
                let (Some(tag), Some(min), Some(max)) =
                    (data.get(a..a + 4), fixed(data, a + 4), fixed(data, a + 12))
                else {
                    break;
                };
                match tag {
                    b"wght" => info.wght = Some((min, max)),
                    b"wdth" => info.wdth = Some((min, max)),
                    _ => {}
                }
            }
        }
    }
    info
}

// ── Parsed-font cache (keyed by file id + updated_at) ────────────────────────

type InfoCache = Mutex<HashMap<Uuid, (DateTime<Utc>, FontInfo)>>;

fn info_cache() -> &'static InfoCache {
    static CACHE: OnceLock<InfoCache> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

// ── Query-string parsing (css2 style) ────────────────────────────────────────

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Families out of a css2-style query string. The axis spec after `:`
/// (`:opsz,wght@…`) is accepted and ignored — the variable files serve their
/// whole ranges anyway.
fn parse_query(query: &str) -> (Vec<String>, String) {
    let mut families = Vec::new();
    let mut display = "swap".to_string();
    for kv in query.split('&') {
        let Some((k, v)) = kv.split_once('=') else { continue };
        let v = percent_decode(&v.replace('+', " "));
        match k {
            "family" => {
                let name = v.split(':').next().unwrap_or("").trim().to_string();
                if !name.is_empty() && !families.contains(&name) {
                    families.push(name);
                }
            }
            "display" if ["auto", "block", "swap", "fallback", "optional"].contains(&v.as_str()) => {
                display = v;
            }
            _ => {}
        }
    }
    (families, display)
}

// ── Handlers ─────────────────────────────────────────────────────────────────

const FONT_EXTENSIONS: &[&str] = &["ttf", "otf", "woff", "woff2"];

fn css_format(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "woff2" => "woff2",
        "woff" => "woff",
        "otf" => "opentype",
        _ => "truetype",
    }
}

fn font_content_type(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "otf" => "font/otf",
        _ => "font/ttf",
    }
}

async fn font_files(db: &PgPool) -> Result<Vec<(Uuid, String, String, DateTime<Utc>)>> {
    let rows: Vec<(Uuid, String, String, DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, name, storage_path, updated_at FROM drive.files
         WHERE owner_id = $1 AND folder_id = $2 AND is_trashed = FALSE",
    )
    .bind(SYSTEM_OWNER)
    .bind(FONTS_FOLDER_ID)
    .fetch_all(db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "System font listing failed");
        e
    })?;
    Ok(rows
        .into_iter()
        .filter(|(_, name, _, _)| {
            let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
            FONT_EXTENSIONS.contains(&ext.as_str())
        })
        .collect())
}

/// `GET /fonts/css2?family=…[&family=…][&display=swap]`
pub async fn css2(State(s): State<AppState>, RawQuery(query): RawQuery) -> Result<Response> {
    let (families, display) = parse_query(query.as_deref().unwrap_or(""));
    if families.is_empty() {
        return Err(FilesError::Validation("Paramètre 'family' manquant".into()));
    }

    let mut css = String::new();
    for (id, name, storage_path, updated_at) in font_files(&s.db).await? {
        // Parse (or reuse) the file's descriptors.
        let cached = info_cache()
            .lock()
            .ok()
            .and_then(|c| c.get(&id).filter(|(ts, _)| *ts == updated_at).map(|(_, i)| i.clone()));
        let info = match cached {
            Some(i) => i,
            None => {
                let data = s.storage.get(&storage_path).await?;
                let info = parse_font_info(&data);
                if let Ok(mut c) = info_cache().lock() {
                    c.insert(id, (updated_at, info.clone()));
                }
                info
            }
        };

        let Some(family) = info.family.clone() else { continue };
        if !families.iter().any(|f| f.eq_ignore_ascii_case(&family)) {
            continue;
        }

        let weight = match info.wght {
            Some((min, max)) => format!("{} {}", min as i32, max as i32),
            None => info.weight_class.to_string(),
        };
        let stretch = info
            .wdth
            .map(|(min, max)| format!("  font-stretch: {}% {}%;\n", min as i32, max as i32))
            .unwrap_or_default();
        let style = if info.italic { "italic" } else { "normal" };
        css.push_str(&format!(
            "@font-face {{\n  font-family: '{family}';\n  font-style: {style};\n  \
             font-weight: {weight};\n{stretch}  font-display: {display};\n  \
             src: url('/api/v1/drive/fonts/files/{id}') format('{}');\n}}\n",
            css_format(&name),
        ));
    }

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/css; charset=utf-8")
        // Short-lived: an admin adding/replacing a font propagates in minutes.
        .header(header::CACHE_CONTROL, "public, max-age=300")
        .body(Body::from(css))
        .expect("valid response"))
}

/// `GET /fonts/files/:id` — binary of one System/Fonts file, long-cached with
/// an ETag so a replaced font still refreshes.
pub async fn file(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response> {
    let row: Option<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT storage_path, name, content_hash FROM drive.files
         WHERE id = $1 AND owner_id = $2 AND folder_id = $3 AND is_trashed = FALSE",
    )
    .bind(id)
    .bind(SYSTEM_OWNER)
    .bind(FONTS_FOLDER_ID)
    .fetch_optional(&s.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, %id, "System font fetch failed");
        e
    })?;
    let Some((storage_path, name, hash)) = row else {
        return Err(FilesError::NotFound(format!("Police {id} introuvable")));
    };

    let etag = hash.map(|h| format!("\"{h}\""));
    if let (Some(etag), Some(if_none)) = (&etag, headers.get(header::IF_NONE_MATCH)) {
        if if_none.to_str().is_ok_and(|v| v == etag) {
            return Ok(Response::builder()
                .status(StatusCode::NOT_MODIFIED)
                .body(Body::empty())
                .expect("valid response"));
        }
    }

    let data = s.storage.get(&storage_path).await?;
    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, font_content_type(&name))
        .header(header::CONTENT_LENGTH, data.len())
        .header(header::CACHE_CONTROL, "public, max-age=86400");
    if let Some(etag) = etag {
        builder = builder.header(header::ETAG, etag);
    }
    Ok(builder.body(Body::from(data)).expect("valid response"))
}
