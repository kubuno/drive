//! Delta synchronisation: returns every change to a user's files and folders
//! beyond a cursor, so offline-first clients can reconcile on reconnection.
//!
//! Three sources are merged and ordered by the monotonic `change_seq`:
//!   - files   (active or soft-trashed)
//!   - folders (active or soft-trashed)
//!   - tombstones (hard-deleted items)
//!
//! Each source is fetched bounded by `limit + 1` rows; the merge keeps the
//! `limit` lowest sequences and reports `has_more` so the client paginates by
//! advancing its cursor. All queries are scoped to `owner_id` — a client never
//! sees another user's data.

use std::sync::Arc;

use bytes::Bytes;
use chrono::{DateTime, Utc};
use kubuno_storage::StorageBackend;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    models::File,
    services::files,
};

#[derive(sqlx::FromRow)]
struct FileChange {
    id:           Uuid,
    name:         String,
    folder_id:    Option<Uuid>,
    content_hash: Option<String>,
    size_bytes:   i64,
    mime_type:    String,
    is_trashed:   bool,
    change_seq:   i64,
}

#[derive(sqlx::FromRow)]
struct FolderChange {
    id:         Uuid,
    name:       String,
    parent_id:  Option<Uuid>,
    path:       String,
    is_trashed: bool,
    change_seq: i64,
}

#[derive(sqlx::FromRow)]
struct TombstoneChange {
    id:         Uuid,
    kind:       String,
    path:       Option<String>,
    change_seq: i64,
    deleted_at: DateTime<Utc>,
}

/// One change in the delta stream, paired with its sequence for merge-sorting.
struct Change {
    seq:   i64,
    value: Value,
}

/// Result of a delta query.
pub struct Delta {
    pub changes:  Vec<Value>,
    pub cursor:   i64,
    pub has_more: bool,
}

/// Returns changes with `change_seq > cursor`, at most `limit` of them.
pub async fn delta(db: &PgPool, owner_id: Uuid, cursor: i64, limit: i64, full: bool) -> Result<Delta> {
    // Fetch one extra per source so the merge can tell whether more remain.
    let fetch = limit + 1;

    let files = sqlx::query_as::<_, FileChange>(
        r#"SELECT id, name, folder_id, content_hash, size_bytes, mime_type, is_trashed, change_seq
           FROM drive.files
           WHERE owner_id = $1 AND change_seq > $2
           ORDER BY change_seq
           LIMIT $3"#,
    )
    .bind(owner_id)
    .bind(cursor)
    .bind(fetch)
    .fetch_all(db)
    .await?;

    let folders = sqlx::query_as::<_, FolderChange>(
        r#"SELECT id, name, parent_id, path, is_trashed, change_seq
           FROM drive.folders
           WHERE owner_id = $1 AND change_seq > $2
           ORDER BY change_seq
           LIMIT $3"#,
    )
    .bind(owner_id)
    .bind(cursor)
    .bind(fetch)
    .fetch_all(db)
    .await?;

    let tombstones = sqlx::query_as::<_, TombstoneChange>(
        r#"SELECT id, kind, path, change_seq, deleted_at
           FROM drive.tombstones
           WHERE owner_id = $1 AND change_seq > $2
           ORDER BY change_seq
           LIMIT $3"#,
    )
    .bind(owner_id)
    .bind(cursor)
    .bind(fetch)
    .fetch_all(db)
    .await?;

    let mut merged: Vec<Change> = Vec::with_capacity(files.len() + folders.len() + tombstones.len());

    for f in files {
        merged.push(Change {
            seq: f.change_seq,
            // etag = content_hash (already a SHA-256); used by the client for
            // If-Match conflict detection on uploads.
            value: json!({
                "kind":       "file",
                "id":         f.id,
                "name":       f.name,
                "folder_id":  f.folder_id,
                "etag":       f.content_hash,
                "size":       f.size_bytes,
                "mime_type":  f.mime_type,
                "trashed":    f.is_trashed,
                "change_seq": f.change_seq,
            }),
        });
    }
    for f in folders {
        merged.push(Change {
            seq: f.change_seq,
            value: json!({
                "kind":       "folder",
                "id":         f.id,
                "name":       f.name,
                "parent_id":  f.parent_id,
                "path":       f.path,
                "trashed":    f.is_trashed,
                "change_seq": f.change_seq,
            }),
        });
    }
    for t in tombstones {
        merged.push(Change {
            seq: t.change_seq,
            value: json!({
                "kind":       "deleted",
                "id":         t.id,
                "target":     t.kind,
                "path":       t.path,
                "deleted_at": t.deleted_at,
                "change_seq": t.change_seq,
            }),
        });
    }

    // `full` : enrichit chaque change file/folder avec le modèle COMPLET (byte-compatible
    // avec GET /folders et GET /), pour le store local drive-core. 2 requêtes en plus,
    // uniquement en mode full ; le sous-ensemble reste pour la rétro-compat kubuno-sync.
    if full {
        use std::collections::HashMap;
        let pick = |kind: &str| -> Vec<Uuid> {
            merged.iter()
                .filter(|c| c.value["kind"] == kind)
                .filter_map(|c| c.value["id"].as_str().and_then(|s| Uuid::parse_str(s).ok()))
                .collect()
        };
        let file_ids = pick("file");
        let folder_ids = pick("folder");

        let mut fmap: HashMap<Uuid, Value> = HashMap::new();
        if !file_ids.is_empty() {
            let files = sqlx::query_as::<_, crate::models::file::File>(
                "SELECT * FROM drive.files WHERE id = ANY($1)",
            ).bind(&file_ids).fetch_all(db).await?;
            for f in files { fmap.insert(f.id, json!(f)); }
        }
        let mut dmap: HashMap<Uuid, Value> = HashMap::new();
        if !folder_ids.is_empty() {
            let folders = sqlx::query_as::<_, crate::models::folder::Folder>(
                "SELECT * FROM drive.folders WHERE id = ANY($1)",
            ).bind(&folder_ids).fetch_all(db).await?;
            for f in folders { dmap.insert(f.id, json!(f)); }
        }
        for c in merged.iter_mut() {
            let id = c.value["id"].as_str().and_then(|s| Uuid::parse_str(s).ok());
            if let Some(id) = id {
                if c.value["kind"] == "file" {
                    if let Some(m) = fmap.get(&id) { c.value["file"] = m.clone(); }
                } else if c.value["kind"] == "folder" {
                    if let Some(m) = dmap.get(&id) { c.value["folder"] = m.clone(); }
                }
            }
        }
    }

    merged.sort_by_key(|c| c.seq);

    let has_more = merged.len() as i64 > limit;
    merged.truncate(limit as usize);

    // Cursor = highest sequence returned (or unchanged if nothing new).
    let next_cursor = merged.last().map(|c| c.seq).unwrap_or(cursor);
    let changes = merged.into_iter().map(|c| c.value).collect();

    Ok(Delta {
        changes,
        cursor: next_cursor,
        has_more,
    })
}

/// Replaces a file's content (any mime type) with conflict detection.
///
/// If `if_match` is given and differs from the current content hash (etag), the
/// server refuses with `PreconditionFailed` (HTTP 412) — the file changed since
/// the client last saw it. Otherwise the content is stored, the hash/size are
/// recomputed and the updated record (with the new etag) is returned.
pub async fn replace_content(
    db: &PgPool,
    storage: &Arc<dyn StorageBackend>,
    owner_id: Uuid,
    file_id: Uuid,
    data: Bytes,
    if_match: Option<&str>,
) -> Result<File> {
    let file = files::get_file(db, owner_id, file_id).await?;

    if let Some(expected) = if_match {
        if file.content_hash.as_deref() != Some(expected) {
            return Err(FilesError::PreconditionFailed(format!(
                "le fichier a changé sur le serveur (etag attendu {expected})"
            )));
        }
    }

    let size = data.len() as i64;
    let size_delta = size - file.size_bytes;

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let hash = hex::encode(hasher.finalize());

    storage.put(&file.storage_path, data).await?;

    let updated = sqlx::query_as::<_, File>(
        "UPDATE drive.files
            SET size_bytes = $1, content_hash = $2, has_thumbnail = FALSE, updated_at = NOW()
          WHERE id = $3
          RETURNING *",
    )
    .bind(size)
    .bind(&hash)
    .bind(file_id)
    .fetch_one(db)
    .await?;

    files::update_used_bytes(db, owner_id, size_delta).await;

    Ok(updated)
}
