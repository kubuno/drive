//! IconCacheService (mirror of IconCacheService.cs)
//!
//! Port of `Files.App/Services/Storage/IconCacheService.cs`: cache of real
//! shell icons (IShellItemImageFactory) as Direct2D bitmaps. The public API
//! is exposed via `crate::services::storage::IconCache`.

use std::cell::Cell;
use std::collections::HashMap;

use windows::Win32::Graphics::Direct2D::{ID2D1Bitmap1, ID2D1DeviceContext};

use crate::utils::thumbnails::file_thumbnail_helper::{fetch_icon, spawn_worker, upload};

pub(crate) type Key = (String, i32, bool);
/// Decoded pixels handed from the thumbnail worker to the UI thread.
pub(crate) type ThumbResults = std::sync::Arc<std::sync::Mutex<Vec<(Key, Option<kubuno_drive_desktop_app_storage::ShellBitmap>)>>>;

/// Resident-byte budget for cached icons and thumbnails. A grid thumbnail at 256 px
/// decodes to ~256 KB; without a bound, browsing thousands of images retains hundreds
/// of MB of never-freed bitmaps.
const ICON_BUDGET_BYTES: usize = 128 * 1024 * 1024;

struct Entry {
    bitmap: Option<ID2D1Bitmap1>,
    bytes: usize,
    last: Cell<u64>,
}

/// The resident byte cost of a decoded bitmap (width*height*4).
fn bitmap_bytes(b: &ID2D1Bitmap1) -> usize {
    // SAFETY: a plain COM getter on a live bitmap.
    let s = unsafe { b.GetPixelSize() };
    (s.width as usize) * (s.height as usize) * 4
}

#[derive(Default)]
pub struct IconCache {
    /// Decoded icons/thumbnails, bounded by [`ICON_BUDGET_BYTES`] with LRU eviction.
    map: HashMap<Key, Entry>,
    /// Running sum of the resident bytes of the cached bitmaps.
    bytes: usize,
    /// Monotonic access clock for LRU recency (interior-mutable so `get` stays `&self`).
    tick: Cell<u64>,
    /// Thumbnail requests already queued to the worker.
    pending: std::collections::HashSet<Key>,
    /// Decoded pixels delivered by the worker, awaiting D2D upload.
    results: ThumbResults,
    worker: Option<std::sync::mpsc::Sender<Key>>,
}

impl IconCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Drops all cached bitmaps (device loss).
    pub fn clear(&mut self) {
        self.map.clear();
        self.bytes = 0;
    }

    /// Refreshes an entry's LRU recency on access (interior-mutable, so callers keep `&self`).
    fn touch(&self, e: &Entry) {
        let t = self.tick.get() + 1;
        self.tick.set(t);
        e.last.set(t);
    }

    /// Inserts a decoded bitmap (replacing any previous one for `key`) and evicts the
    /// least-recently-used entries until the cache is back under its byte budget.
    fn put(&mut self, key: Key, bitmap: Option<ID2D1Bitmap1>) {
        let bytes = bitmap.as_ref().map(bitmap_bytes).unwrap_or(0);
        let t = self.tick.get() + 1;
        self.tick.set(t);
        if let Some(old) = self.map.insert(key, Entry { bitmap, bytes, last: Cell::new(t) }) {
            self.bytes = self.bytes.saturating_sub(old.bytes);
        }
        self.bytes += bytes;
        while self.bytes > ICON_BUDGET_BYTES && self.map.len() > 1 {
            let Some(lru) = self.map.iter().min_by_key(|(_, e)| e.last.get()).map(|(k, _)| k.clone()) else { break };
            if let Some(e) = self.map.remove(&lru) {
                self.bytes = self.bytes.saturating_sub(e.bytes);
            }
        }
    }

    pub fn get(&self, path: &str, size_px: i32) -> Option<&ID2D1Bitmap1> {
        let e = self.map.get(&(path.to_string(), size_px, false))?;
        self.touch(e);
        e.bitmap.as_ref()
    }

    /// Content thumbnail (image/PDF preview) with icon fallback.
    pub fn get_thumbnail(&self, path: &str, size_px: i32) -> Option<&ID2D1Bitmap1> {
        if let Some(e) = self.map.get(&(path.to_string(), size_px, true)) {
            self.touch(e);
            if let Some(b) = e.bitmap.as_ref() {
                return Some(b);
            }
        }
        self.get(path, size_px)
    }

    /// Fetches and caches the shell icon for `path` if not already present.
    /// Failures are cached as `None` so they are not retried every frame.
    pub fn ensure(&mut self, ctx: &ID2D1DeviceContext, path: &str, size_px: i32) {
        self.ensure_kind(ctx, path, size_px, false);
    }

    /// Preloads an `imageres.dll` icon by index (`Constants.ImageRes`:
    /// the sidebar's Drives/Network sections). Key "imageres:{index}".
    pub fn ensure_imageres(&mut self, ctx: &ID2D1DeviceContext, index: i32, size_px: i32) {
        let key = (format!("imageres:{index}"), size_px, false);
        if self.map.contains_key(&key) {
            return;
        }
        let bitmap = crate::utils::shell::imageres_icon(index, size_px).and_then(|b| upload(ctx, &b));
        self.put(key, bitmap);
    }

    /// Same, but preferring the content thumbnail — fetched ASYNCHRONOUSLY on
    /// a dedicated STA worker (thumbnail providers can take seconds; the C#
    /// original also loads them off the UI thread).
    pub fn ensure_thumbnail(&mut self, ctx: &ID2D1DeviceContext, path: &str, size_px: i32, hwnd_raw: isize) {
        // Fast path: the plain icon shows instantly while the thumbnail loads.
        self.ensure_kind(ctx, path, size_px, false);

        let key = (path.to_string(), size_px, true);
        if self.map.contains_key(&key) || self.pending.contains(&key) {
            return;
        }
        self.pending.insert(key.clone());
        let sender = self.worker.get_or_insert_with(|| spawn_worker(std::sync::Arc::clone(&self.results), hwnd_raw));
        if sender.send(key.clone()).is_err() {
            // Worker died: retry with a fresh one next frame.
            self.worker = None;
            self.pending.remove(&key);
        }
    }

    /// Uploads worker results into D2D bitmaps (call on WM_APP_ICON_READY).
    pub fn drain_results(&mut self, ctx: &ID2D1DeviceContext) {
        let results: Vec<_> = std::mem::take(&mut *self.results.lock().unwrap());
        for (key, shell_bitmap) in results {
            self.pending.remove(&key);
            let bitmap = shell_bitmap.and_then(|b| upload(ctx, &b));
            self.put(key, bitmap);
        }
    }

    fn ensure_kind(&mut self, ctx: &ID2D1DeviceContext, path: &str, size_px: i32, thumbnail: bool) {
        let key = (path.to_string(), size_px, thumbnail);
        if self.map.contains_key(&key) {
            return;
        }
        let bitmap = fetch_icon(ctx, path, size_px, thumbnail);
        self.put(key, bitmap);
    }
}
