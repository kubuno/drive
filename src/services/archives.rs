//! Multi-format archive abstraction: read/list/extract and create archives in
//! ZIP, TAR and TAR.GZ. Keeps the handlers format-agnostic.

use std::io::{Cursor, Read, Write};

use crate::errors::{FilesError, Result};

/// Safety cap on the total uncompressed size we will extract (anti zip-bomb).
const MAX_TOTAL_BYTES: u64 = 4 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveKind {
    Zip,
    Tar,
    TarGz,
}

/// One archive entry's metadata (no content).
#[derive(Debug, Clone)]
pub struct ArchiveIndexEntry {
    pub path:   String,
    pub is_dir: bool,
    pub size:   u64,
}

/// One archive entry with its decompressed content (empty for directories).
#[derive(Debug, Clone)]
pub struct ArchiveItem {
    pub path:   String,
    pub is_dir: bool,
    pub data:   Vec<u8>,
}

/// Detects the archive kind from the file name (preferred) or MIME type.
pub fn detect_kind(name: &str, mime: &str) -> Option<ArchiveKind> {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        return Some(ArchiveKind::TarGz);
    }
    if lower.ends_with(".tar") {
        return Some(ArchiveKind::Tar);
    }
    if lower.ends_with(".zip") || mime.contains("zip") {
        return Some(ArchiveKind::Zip);
    }
    if mime.contains("x-tar") {
        return Some(ArchiveKind::Tar);
    }
    None
}

fn invalid(e: impl std::fmt::Display) -> FilesError {
    FilesError::Validation(format!("Archive invalide : {e}"))
}

fn tar_reader<'a>(kind: ArchiveKind, data: &'a [u8]) -> Box<dyn Read + 'a> {
    match kind {
        ArchiveKind::TarGz => Box::new(flate2::read::GzDecoder::new(Cursor::new(data))),
        _ => Box::new(Cursor::new(data)),
    }
}

/// Lists entries (paths + sizes) without extracting their content.
pub fn read_index(kind: ArchiveKind, data: &[u8]) -> Result<Vec<ArchiveIndexEntry>> {
    match kind {
        ArchiveKind::Zip => {
            let mut zip = zip::ZipArchive::new(Cursor::new(data)).map_err(invalid)?;
            let mut out = Vec::with_capacity(zip.len());
            for i in 0..zip.len() {
                let e = zip.by_index(i).map_err(invalid)?;
                out.push(ArchiveIndexEntry {
                    path:   e.name().to_string(),
                    is_dir: e.is_dir(),
                    size:   e.size(),
                });
            }
            Ok(out)
        }
        kind => {
            let mut ar = tar::Archive::new(tar_reader(kind, data));
            let mut out = Vec::new();
            for entry in ar.entries().map_err(invalid)? {
                let entry = entry.map_err(invalid)?;
                let path = entry.path().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
                if path.is_empty() {
                    continue;
                }
                let is_dir = entry.header().entry_type().is_dir();
                let size = entry.header().size().unwrap_or(0);
                out.push(ArchiveIndexEntry { path, is_dir, size });
            }
            Ok(out)
        }
    }
}

/// Extracts every entry with its content. Enforces a total-size safety cap.
pub fn read_all(kind: ArchiveKind, data: &[u8]) -> Result<Vec<ArchiveItem>> {
    let mut total: u64 = 0;
    match kind {
        ArchiveKind::Zip => {
            let mut zip = zip::ZipArchive::new(Cursor::new(data)).map_err(invalid)?;
            let mut out = Vec::with_capacity(zip.len());
            for i in 0..zip.len() {
                let mut e = zip.by_index(i).map_err(invalid)?;
                let path = e.name().to_string();
                let is_dir = e.is_dir();
                let mut buf = Vec::new();
                if !is_dir {
                    total = total.saturating_add(e.size());
                    if total > MAX_TOTAL_BYTES {
                        return Err(FilesError::Validation("Archive trop volumineuse".into()));
                    }
                    e.read_to_end(&mut buf).map_err(|err| FilesError::Internal(anyhow::anyhow!(err)))?;
                }
                out.push(ArchiveItem { path, is_dir, data: buf });
            }
            Ok(out)
        }
        kind => {
            let mut ar = tar::Archive::new(tar_reader(kind, data));
            let mut out = Vec::new();
            for entry in ar.entries().map_err(invalid)? {
                let mut entry = entry.map_err(invalid)?;
                let path = entry.path().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
                if path.is_empty() {
                    continue;
                }
                let is_dir = entry.header().entry_type().is_dir();
                let mut buf = Vec::new();
                if !is_dir {
                    total = total.saturating_add(entry.header().size().unwrap_or(0));
                    if total > MAX_TOTAL_BYTES {
                        return Err(FilesError::Validation("Archive trop volumineuse".into()));
                    }
                    entry.read_to_end(&mut buf).map_err(|err| FilesError::Internal(anyhow::anyhow!(err)))?;
                }
                out.push(ArchiveItem { path, is_dir, data: buf });
            }
            Ok(out)
        }
    }
}

/// Extracts a single entry by its internal path.
pub fn read_single(kind: ArchiveKind, data: &[u8], target: &str) -> Result<Vec<u8>> {
    let target = target.trim_matches('/');
    match kind {
        ArchiveKind::Zip => {
            let mut zip = zip::ZipArchive::new(Cursor::new(data)).map_err(invalid)?;
            let mut entry = zip
                .by_name(target)
                .map_err(|_| FilesError::NotFound(format!("'{target}' introuvable dans l'archive")))?;
            let mut buf = Vec::with_capacity(entry.size() as usize);
            entry.read_to_end(&mut buf).map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;
            Ok(buf)
        }
        kind => {
            let mut ar = tar::Archive::new(tar_reader(kind, data));
            for entry in ar.entries().map_err(invalid)? {
                let mut entry = entry.map_err(invalid)?;
                let path = entry.path().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
                if path.trim_end_matches('/') == target {
                    let mut buf = Vec::new();
                    entry.read_to_end(&mut buf).map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;
                    return Ok(buf);
                }
            }
            Err(FilesError::NotFound(format!("'{target}' introuvable dans l'archive")))
        }
    }
}

/// Builds a ZIP from explicit directories and (path, content) files.
pub fn write_zip(dirs: &[String], files: &[(String, Vec<u8>)]) -> Result<Vec<u8>> {
    use zip::write::SimpleFileOptions;
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for d in dirs {
        let _ = zip.add_directory(format!("{}/", d.trim_end_matches('/')), SimpleFileOptions::default());
    }
    for (path, data) in files {
        zip.start_file(path, opts).map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;
        zip.write_all(data).map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;
    }
    let cursor = zip.finish().map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;
    Ok(cursor.into_inner())
}

/// Builds a gzip-compressed TAR from explicit directories and (path, content) files.
pub fn write_targz(dirs: &[String], files: &[(String, Vec<u8>)]) -> Result<Vec<u8>> {
    use flate2::{write::GzEncoder, Compression};
    let gz = GzEncoder::new(Vec::new(), Compression::default());
    let mut builder = tar::Builder::new(gz);

    for d in dirs {
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Directory);
        header.set_size(0);
        header.set_mode(0o755);
        header.set_mtime(0);
        let path = format!("{}/", d.trim_end_matches('/'));
        builder
            .append_data(&mut header, &path, std::io::empty())
            .map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;
    }
    for (path, data) in files {
        let mut header = tar::Header::new_gnu();
        header.set_size(data.len() as u64);
        header.set_mode(0o644);
        header.set_mtime(0);
        builder
            .append_data(&mut header, path, &data[..])
            .map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;
    }
    let gz = builder.into_inner().map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;
    let buf = gz.finish().map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;
    Ok(buf)
}
