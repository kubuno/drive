//! Extraction de texte pour l'indexation de recherche.
//! Best-effort, plafonné, ne panique jamais (PDF malformés capturés via catch_unwind).
//! Appelé depuis un `spawn_blocking` par l'indexeur.

use std::io::{Cursor, Read};

/// Plafond du texte extrait conservé pour l'index (~1 Mo) — borne la tsvector et la mémoire.
pub const MAX_EXTRACT_BYTES: usize = 1_048_576;

/// Extensions « texte » indexées directement en UTF-8.
const TEXT_EXTS: &[&str] = &[
    "txt", "md", "markdown", "rst", "log", "csv", "tsv", "json", "yaml", "yml", "toml", "ini",
    "xml", "html", "htm", "css", "scss", "sql", "sh", "bash", "zsh", "rs", "py", "js", "jsx",
    "ts", "tsx", "go", "java", "kt", "c", "h", "cpp", "hpp", "cc", "cs", "rb", "php", "swift",
    "lua", "pl", "r", "dart", "vue", "svelte", "tex", "conf", "env", "gitignore", "dockerfile",
];

fn ext_of(name: &str) -> String {
    name.rsplit('.').next().filter(|e| *e != name).unwrap_or("").to_lowercase()
}

fn cap(mut s: String) -> String {
    if s.len() > MAX_EXTRACT_BYTES {
        s.truncate(MAX_EXTRACT_BYTES);
        // Ne pas couper au milieu d'un point de code UTF-8
        while !s.is_char_boundary(s.len()) { s.pop(); }
    }
    s
}

/// Renvoie le texte extrait pour l'indexation, ou `None` si non supporté / échec.
pub fn extract_text(mime: &str, name: &str, bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() { return None; }
    let ext = ext_of(name);

    // 1. Texte / code brut
    if mime.starts_with("text/")
        || mime == "application/json"
        || mime == "application/xml"
        || mime == "application/javascript"
        || mime == "application/x-yaml"
        || TEXT_EXTS.contains(&ext.as_str())
    {
        let slice = &bytes[..bytes.len().min(MAX_EXTRACT_BYTES)];
        let text = String::from_utf8_lossy(slice).into_owned();
        let trimmed = text.trim();
        return if trimmed.is_empty() { None } else { Some(cap(text)) };
    }

    // 2. PDF — pdf-extract peut paniquer sur des PDF malformés → catch_unwind
    if mime == "application/pdf" || ext == "pdf" {
        let owned = bytes.to_vec();
        let res = std::panic::catch_unwind(move || {
            pdf_extract::extract_text_from_mem(&owned).ok()
        });
        return match res {
            Ok(Some(t)) if !t.trim().is_empty() => Some(cap(t)),
            _ => None,
        };
    }

    // 3. Documents Office (zip + XML)
    let is_docx = ext == "docx" || mime.contains("wordprocessingml");
    let is_xlsx = ext == "xlsx" || mime.contains("spreadsheetml");
    let is_pptx = ext == "pptx" || mime.contains("presentationml");
    if is_docx || is_xlsx || is_pptx {
        return extract_office(bytes, is_docx, is_xlsx, is_pptx).filter(|s| !s.trim().is_empty()).map(cap);
    }

    // 4. Formats natifs Kubuno (.kb*** = JSON gzippé). Documents, tableurs,
    //    présentations, diagrammes, scripts, formules maths, notes, etc. Le
    //    contenu n'est PAS en clair : il faut le décompresser puis récolter
    //    les chaînes pertinentes du JSON pour les rendre cherchables.
    let is_kubuno = mime.starts_with("application/vnd.kubuno")
        || (ext.starts_with("kb") && bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b);
    if is_kubuno {
        return extract_kubuno(bytes).filter(|s| !s.trim().is_empty()).map(cap);
    }

    None
}

/// Décompresse un fichier natif Kubuno (gzip → JSON) et récolte le texte utile.
/// Best-effort : renvoie `None` si la décompression ou le parsing échoue.
fn extract_kubuno(bytes: &[u8]) -> Option<String> {
    use flate2::read::GzDecoder;

    // Décompression bornée (anti zip-bomb) : on ne lit que ~4 Mo de JSON décodé.
    const MAX_DECOMPRESSED: u64 = 4 * 1_048_576;
    let mut decoder = GzDecoder::new(Cursor::new(bytes)).take(MAX_DECOMPRESSED);
    let mut json_str = String::new();
    decoder.read_to_string(&mut json_str).ok()?;

    let value: serde_json::Value = serde_json::from_str(&json_str).ok()?;
    let mut out = String::new();
    harvest_json_text(&value, &mut out, 0);
    if out.is_empty() { None } else { Some(out) }
}

/// Clés dont la valeur est structurelle ou binaire (jamais du texte cherchable).
const SKIP_KEYS: &[&str] = &[
    "id", "uuid", "type", "kind", "color", "fill", "stroke", "background", "bg",
    "src", "href", "url", "data", "embedding", "thumbnail", "hash", "phash",
    "version", "rev", "mime", "format", "encoding", "font", "fontfamily",
    "icon", "ref", "parent", "target", "source", "key", "class", "style",
    "align", "valign", "textalign", "halign", "anchor", "position", "variant",
    "createdat", "updatedat", "created", "updated", "modified", "date", "time",
    "timestamp", "ts", "at", "uri", "path", "filename", "extension",
];

/// Parcourt récursivement un JSON et concatène les chaînes « texte » (séparées
/// par des espaces), en ignorant les valeurs structurelles, les UUID, les
/// URLs `data:` et les longs blobs base64.
fn harvest_json_text(value: &serde_json::Value, out: &mut String, depth: usize) {
    if depth > 64 || out.len() >= MAX_EXTRACT_BYTES { return; }
    match value {
        serde_json::Value::String(s) => {
            if is_meaningful_text(s) {
                out.push_str(s.trim());
                out.push(' ');
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                harvest_json_text(v, out, depth + 1);
                if out.len() >= MAX_EXTRACT_BYTES { break; }
            }
        }
        serde_json::Value::Object(map) => {
            for (k, v) in map {
                if SKIP_KEYS.contains(&k.to_lowercase().as_str()) { continue; }
                harvest_json_text(v, out, depth + 1);
                if out.len() >= MAX_EXTRACT_BYTES { break; }
            }
        }
        _ => {}
    }
}

/// Heuristique : la chaîne ressemble-t-elle à du texte lisible (et non à un
/// identifiant, une URL data:, une couleur ou un blob base64) ?
fn is_meaningful_text(s: &str) -> bool {
    let t = s.trim();
    if t.len() < 2 || t.len() > 100_000 { return false; }
    // URL data: / base64 inline
    if t.starts_with("data:") || t.starts_with("blob:") { return false; }
    // Couleur hex
    if t.starts_with('#') && t.len() <= 9 && t[1..].chars().all(|c| c.is_ascii_hexdigit()) {
        return false;
    }
    // UUID (8-4-4-4-12)
    let dashes = t.matches('-').count();
    if t.len() == 36 && dashes == 4 && t.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return false;
    }
    // Horodatage ISO-8601 (ex: 2026-06-08T15:00:11.818Z)
    if t.len() >= 19 && t.as_bytes()[10] == b'T'
        && t[..10].chars().all(|c| c.is_ascii_digit() || c == '-')
        && (t.ends_with('Z') || t.contains('+'))
    {
        return false;
    }
    // Long jeton sans espace = probablement base64 / hash / chemin technique
    if !t.contains(' ') && t.len() > 80 {
        return false;
    }
    // Au moins une lettre alphabétique pour éviter les valeurs purement numériques.
    t.chars().any(|c| c.is_alphabetic())
}

/// Extrait le texte des entrées XML pertinentes d'un document Office (OOXML).
fn extract_office(bytes: &[u8], docx: bool, xlsx: bool, pptx: bool) -> Option<String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).ok()?;

    // Quelles entrées lire ?
    let mut targets: Vec<String> = Vec::new();
    if docx { targets.push("word/document.xml".into()); }
    if xlsx { targets.push("xl/sharedStrings.xml".into()); }
    if pptx {
        // slides numérotées : collecter tous les noms ppt/slides/slideN.xml
        for i in 0..archive.len() {
            if let Ok(f) = archive.by_index(i) {
                let n = f.name().to_string();
                if n.starts_with("ppt/slides/slide") && n.ends_with(".xml") {
                    targets.push(n);
                }
            }
        }
    }

    let mut out = String::new();
    for target in targets {
        let mut xml = String::new();
        if let Ok(mut entry) = archive.by_name(&target) {
            if entry.read_to_string(&mut xml).is_ok() {
                xml_text_nodes(&xml, &mut out);
            }
        }
        if out.len() >= MAX_EXTRACT_BYTES { break; }
    }
    if out.is_empty() { None } else { Some(out) }
}

/// Concatène les nœuds texte d'un XML (séparés par des espaces).
fn xml_text_nodes(xml: &str, out: &mut String) {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Text(e)) => {
                if let Ok(t) = e.unescape() {
                    let t = t.trim();
                    if !t.is_empty() {
                        out.push_str(t);
                        out.push(' ');
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
        if out.len() >= MAX_EXTRACT_BYTES { break; }
    }
}
