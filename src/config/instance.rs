//! Instance-wide settings of the drive module, as the administrator left them in
//! the console.
//!
//! The values are declared by `module.toml`'s `[[settings]]` blocks, stored in
//! `core.settings`, and read back here through `/internal/modules/settings` — a
//! module owns its own schema and cannot read the core's tables, and a background
//! refresher has no user token to use the public config route.
//!
//! Every field is reachable from the admin panel AND read by code that acts on
//! it. A knob that changes nothing is worse than an absent one: it tells an
//! administrator a protection is in place when it is not.

use serde_json::Value;

#[derive(Debug, Clone)]
pub struct InstanceConfig {
    /// Days a trashed file is kept before the hourly cleaner purges it for good.
    pub trash_retention_days: i32,
    /// How many revisions of a file are kept; the oldest beyond this are pruned
    /// on every new write.
    pub max_file_versions: i64,
    /// Whether users may create public (tokenised) share links at all. Off turns
    /// the whole public-link feature into a refusal, without touching internal
    /// shares (a share addressed to a named recipient), AND stops serving the
    /// links already created — a switch that only blocks new links would leave
    /// yesterday's exposure in place.
    pub public_links_enabled: bool,
    /// Ceiling on a public link's lifetime, in days. `0` = no ceiling. A link
    /// created with no expiry, or asking for a longer one, is clamped to this.
    pub share_max_expiry_days: i64,
    /// Lifetime stamped on a public link created WITHOUT an expiry date, in
    /// days. `0` = none, the link never expires by itself. Weaker than
    /// `share_max_expiry_days`, which caps even an explicit request.
    pub share_default_expiry_days: i64,
    /// Whether a public link must carry a password. On, a link created without
    /// one is refused rather than silently created open.
    pub share_require_password: bool,
    /// Whether the holder of a public link may download the bytes. Off, the
    /// link only ever reveals the item's name and size — enforced at creation
    /// AND on every download, so the switch also closes existing links.
    pub share_public_download_enabled: bool,
    /// Ceiling on the number of downloads a public link may serve. `0` = no
    /// ceiling. Clamps what the user asks for at creation.
    pub share_max_downloads: i64,
    /// Ceiling on the size of a single uploaded file, in mebibytes. `0` = no
    /// instance ceiling (the server's own `files.max_upload_bytes` still
    /// applies). This value can only LOWER the server limit: the HTTP body
    /// limit is wired into the router at boot and cannot be raised at runtime.
    pub max_upload_mb: i64,
    /// Filename extensions refused at upload, lower-case and without the dot.
    /// Empty = nothing is refused.
    pub blocked_extensions: Vec<String>,
    /// Whether the WebDAV surface answers at all (the module's desktop/native
    /// client access). Off, both the protocol endpoint and the token issuance
    /// refuse.
    pub webdav_enabled: bool,
    /// Whether users may make the server fetch a URL and store the result. This
    /// is server-side egress: an instance that must not reach outward turns it
    /// off.
    pub import_url_enabled: bool,
    /// Whether users may attach third-party storage (the "remote connections"
    /// feature). Off, the connections already declared become unreachable too.
    pub remote_storage_enabled: bool,
}

impl Default for InstanceConfig {
    fn default() -> Self {
        Self {
            trash_retention_days:  30,
            max_file_versions:     50,
            public_links_enabled:  true,
            share_max_expiry_days: 0,
            share_default_expiry_days:     0,
            share_require_password:        false,
            share_public_download_enabled: true,
            share_max_downloads:           0,
            max_upload_mb:                 0,
            blocked_extensions:            Vec::new(),
            webdav_enabled:                true,
            import_url_enabled:            true,
            remote_storage_enabled:        true,
        }
    }
}

impl InstanceConfig {
    /// Maps the core's `{key: value}` object onto the struct. Every read falls
    /// back to the compiled default rather than to a permissive value: a payload
    /// missing a key (an older core, a failed migration) must not silently drop a
    /// protection. Out-of-range numbers are treated as a mistake and ignored the
    /// same way — "as shipped", not "as permissive as possible".
    pub fn from_settings(settings: &Value) -> Self {
        let d = Self::default();
        let int_of = |key: &str, min: i64, max: i64, fallback: i64| -> i64 {
            settings
                .get(key)
                .and_then(Value::as_i64)
                .filter(|n| (min..=max).contains(n))
                .unwrap_or(fallback)
        };
        let bool_of = |key: &str, fallback: bool| {
            settings.get(key).and_then(Value::as_bool).unwrap_or(fallback)
        };
        Self {
            trash_retention_days:  int_of("trash_retention_days", 1, 3650, d.trash_retention_days as i64) as i32,
            max_file_versions:     int_of("max_file_versions", 1, 1000, d.max_file_versions),
            public_links_enabled:  bool_of("share_public_links_enabled", d.public_links_enabled),
            share_max_expiry_days: int_of("share_max_expiry_days", 0, 3650, d.share_max_expiry_days),
            share_default_expiry_days:     int_of("share_default_expiry_days", 0, 3650, d.share_default_expiry_days),
            share_require_password:        bool_of("share_require_password", d.share_require_password),
            share_public_download_enabled: bool_of("share_public_download_enabled", d.share_public_download_enabled),
            share_max_downloads:           int_of("share_max_downloads", 0, 1_000_000, d.share_max_downloads),
            max_upload_mb:                 int_of("max_upload_mb", 0, 1_048_576, d.max_upload_mb),
            blocked_extensions:            parse_extension_list(settings.get("blocked_extensions")),
            webdav_enabled:                bool_of("webdav_enabled", d.webdav_enabled),
            import_url_enabled:            bool_of("import_url_enabled", d.import_url_enabled),
            remote_storage_enabled:        bool_of("remote_storage_enabled", d.remote_storage_enabled),
        }
    }

    /// The effective ceiling on one uploaded file, in bytes: the smaller of the
    /// server's compiled/ops limit and the administrator's. The instance
    /// setting may only tighten — the router's `DefaultBodyLimit` is built once
    /// at boot from the server limit and would reject a larger body anyway, so
    /// letting the console raise it would promise a limit that does not hold.
    pub fn effective_max_upload_bytes(&self, server_max: u64) -> u64 {
        match self.max_upload_mb {
            n if n > 0 => (n as u64).saturating_mul(1024 * 1024).min(server_max),
            _          => server_max,
        }
    }

    /// Refuses a filename whose extension the administrator blocked. The name
    /// is matched on its LAST extension, lower-cased — `setup.EXE` and
    /// `report.pdf.exe` are both `exe`.
    pub fn check_extension_allowed(&self, filename: &str) -> Result<(), String> {
        if self.blocked_extensions.is_empty() {
            return Ok(());
        }
        let ext = filename
            .rsplit_once('.')
            .map(|(_, e)| e.trim().to_ascii_lowercase())
            .unwrap_or_default();
        if !ext.is_empty() && self.blocked_extensions.contains(&ext) {
            return Err(format!(
                "Les fichiers « .{ext} » sont refusés par la politique de l'instance"
            ));
        }
        Ok(())
    }
}

/// Reads the multiline extension list: one entry per line, a leading dot and
/// surrounding spaces tolerated, lower-cased, empties dropped. The console hands
/// it over as a single string, and an administrator types `.exe` as readily as
/// `exe`.
fn parse_extension_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_str)
        .map(|raw| {
            raw.lines()
                .flat_map(|line| line.split(','))
                .map(|e| e.trim().trim_start_matches('.').to_ascii_lowercase())
                .filter(|e| !e.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Reads the instance settings from the core. Any failure yields `None`, so the
/// caller keeps the values it already had rather than reverting to defaults
/// because the core was briefly unreachable.
pub async fn fetch(http: &reqwest::Client, core_url: &str, secret: &str) -> Option<InstanceConfig> {
    // Named by the URL rather than relying on the secret to identify us: on an
    // instance that shares the master secret between modules, the secret-only
    // route cannot tell which module is asking and refuses everyone. The core
    // still holds a caller identified by a derived secret to its own id.
    let url = format!("{core_url}/internal/modules/drive/settings");
    let resp = http
        .get(&url)
        .header("X-Internal-Secret", secret)
        .send()
        .await
        .map_err(|e| tracing::warn!(error = %e, "Lecture des réglages d'instance drive"))
        .ok()?;

    if !resp.status().is_success() {
        tracing::warn!(status = %resp.status(), "Réglages d'instance drive refusés par le core");
        return None;
    }

    let body: Value = resp
        .json()
        .await
        .map_err(|e| tracing::warn!(error = %e, "Réglages d'instance drive : réponse illisible"))
        .ok()?;

    Some(InstanceConfig::from_settings(body.get("settings")?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_keys_keep_the_compiled_defaults() {
        let cfg = InstanceConfig::from_settings(&json!({}));
        let d = InstanceConfig::default();
        assert_eq!(cfg.trash_retention_days, d.trash_retention_days);
        assert_eq!(cfg.max_file_versions, d.max_file_versions);
        assert!(cfg.public_links_enabled);
        assert_eq!(cfg.share_max_expiry_days, 0);
    }

    #[test]
    fn values_are_read_and_clamped() {
        let cfg = InstanceConfig::from_settings(&json!({
            "trash_retention_days": 7,
            "max_file_versions": 10,
            "share_public_links_enabled": false,
            "share_max_expiry_days": 30,
        }));
        assert_eq!(cfg.trash_retention_days, 7);
        assert_eq!(cfg.max_file_versions, 10);
        assert!(!cfg.public_links_enabled);
        assert_eq!(cfg.share_max_expiry_days, 30);
    }

    #[test]
    fn out_of_range_values_fall_back_rather_than_apply() {
        // 0 retention days would purge the trash instantly; the floor refuses it.
        let cfg = InstanceConfig::from_settings(&json!({
            "trash_retention_days": 0,
            "max_file_versions": 99999,
        }));
        assert_eq!(cfg.trash_retention_days, 30);
        assert_eq!(cfg.max_file_versions, 50);
    }

    #[test]
    fn the_upload_ceiling_only_ever_tightens_the_server_limit() {
        let server = 5_368_709_120_u64; // 5 GiB, the shipped limit
        let mut cfg = InstanceConfig::default();
        // Unset: the server limit rules.
        assert_eq!(cfg.effective_max_upload_bytes(server), server);
        // Lower: the administrator wins.
        cfg.max_upload_mb = 100;
        assert_eq!(cfg.effective_max_upload_bytes(server), 100 * 1024 * 1024);
        // Higher than the server limit: clamped, never promised.
        cfg.max_upload_mb = 1_000_000;
        assert_eq!(cfg.effective_max_upload_bytes(server), server);
    }

    #[test]
    fn blocked_extensions_are_parsed_forgivingly_and_matched_case_insensitively() {
        let cfg = InstanceConfig::from_settings(&json!({
            "blocked_extensions": " .EXE \n bat\n\n  , msi ,\n",
        }));
        assert_eq!(cfg.blocked_extensions, vec!["exe", "bat", "msi"]);
        assert!(cfg.check_extension_allowed("rapport.pdf").is_ok());
        assert!(cfg.check_extension_allowed("setup.EXE").is_err());
        // A double extension is judged on the last one — the one the system runs.
        assert!(cfg.check_extension_allowed("facture.pdf.exe").is_err());
        // No extension at all is not a blocked extension.
        assert!(cfg.check_extension_allowed("LISEZMOI").is_ok());
    }

    #[test]
    fn an_empty_block_list_refuses_nothing() {
        let cfg = InstanceConfig::from_settings(&json!({ "blocked_extensions": "   \n  " }));
        assert!(cfg.blocked_extensions.is_empty());
        assert!(cfg.check_extension_allowed("setup.exe").is_ok());
    }

    #[test]
    fn new_switches_default_to_the_behaviour_shipped_before_they_existed() {
        let cfg = InstanceConfig::from_settings(&json!({}));
        assert!(cfg.share_public_download_enabled);
        assert!(!cfg.share_require_password);
        assert_eq!(cfg.share_default_expiry_days, 0);
        assert_eq!(cfg.share_max_downloads, 0);
        assert!(cfg.webdav_enabled);
        assert!(cfg.import_url_enabled);
        assert!(cfg.remote_storage_enabled);
    }
}
