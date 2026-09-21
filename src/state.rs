use crate::config::instance::InstanceConfig;
use crate::config::Settings;
use crate::errors::FilesError;
use kubuno_db::DbPool;
use kubuno_storage::StorageBackend;
use std::sync::{Arc, RwLock};

#[derive(Clone)]
pub struct AppState {
    pub db:       DbPool,
    pub settings: Arc<Settings>,
    pub storage:  Arc<dyn StorageBackend>,
    /// Instance settings from the admin console, refreshed in the background so
    /// an edit takes effect without restarting the module. Read through
    /// [`AppState::instance`], never locked directly by callers.
    pub instance: Arc<RwLock<InstanceConfig>>,
}

impl AppState {
    /// A snapshot of the current instance settings. Falls back to the compiled
    /// defaults if the lock was poisoned by a panicking writer — a lost value
    /// must never take a protection down.
    pub fn instance(&self) -> InstanceConfig {
        self.instance.read().map(|c| c.clone()).unwrap_or_default()
    }

    /// The ceiling on ONE uploaded file, in bytes, as the server's own
    /// configuration and the administrator's console jointly define it. The
    /// console may only tighten: the router's body limit is built at boot from
    /// `files.max_upload_bytes` and would reject a larger body regardless.
    ///
    /// Every upload entry point reads the limit through here, so raising or
    /// lowering it in the console takes effect within the refresh interval,
    /// without a restart.
    pub fn max_upload_bytes(&self) -> u64 {
        self.instance()
            .effective_max_upload_bytes(self.settings.files.max_upload_bytes)
    }

    /// Refuses a file whose extension the administrator blocked instance-wide.
    /// Called by the entry points that let a user CHOOSE a name — plain upload,
    /// chunked upload, URL import, WebDAV — so a blocked extension cannot be
    /// slipped in through the quieter door.
    pub fn check_upload_name(&self, filename: &str) -> Result<(), FilesError> {
        self.instance()
            .check_extension_allowed(filename)
            .map_err(FilesError::PolicyDisabled)
    }
}
