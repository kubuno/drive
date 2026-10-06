//! The platform extension points of the desktop app.
//!
//! Everything the app does is written once, here in `desktop/common`; what only an operating system can do
//! goes through the traits below. Each trait has a portable default, so the app builds and runs on any
//! system with nothing registered; an OS folder (`desktop/windows`, `desktop/linux`, `desktop/macos`)
//! overrides only what it does better, in the [`Platform`] its entry point hands to [`crate::app::run`].
//!
//! | Extension point | Portable default | Windows override (`desktop/windows`) |
//! |---|---|---|
//! | [`FileSystem`] | `std::fs`, dot files hidden | hidden and system attributes |
//! | [`Shell`] | nothing to launch with: [`PlatformError::Unsupported`] | `ShellExecuteW`, shell verbs |
//! | [`Culture`] | `LC_ALL` / `LC_MESSAGES` / `LANG` | `GetUserDefaultLocaleName` |
//! | [`Locale`] | fixed formats, English month names | `GetDateFormatEx`, `GetTimeFormatEx`, `GetLocaleInfoEx` |
//! | [`UiHost`] | a text listing of the start folder ([`crate::app::TextUi`]) | the Win32 window, painted with Direct2D |

use std::sync::OnceLock;

use crate::data::items::DirEntryItem;

/// What a platform service could not do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlatformError {
    /// The platform has no implementation of this service.
    Unsupported(&'static str),
    /// The service failed.
    Failed(String),
}

impl std::fmt::Display for PlatformError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PlatformError::Unsupported(what) => write!(f, "{what} is not available on this platform"),
            PlatformError::Failed(why) => f.write_str(why),
        }
    }
}

impl std::error::Error for PlatformError {}

/// Reading folders.
pub trait FileSystem: Send + Sync {
    /// Whether an entry is hidden unless the user shows hidden items. Default: a name starting with a dot.
    fn is_hidden(&self, name: &str, _metadata: &std::fs::Metadata) -> bool {
        name.starts_with('.')
    }

    /// The entries of the folder at `path`, folders first then files, both by name (case-insensitive);
    /// hidden entries only when `show_hidden`.
    fn load_directory(&self, path: &str, show_hidden: bool) -> std::io::Result<Vec<DirEntryItem>> {
        let mut items = Vec::new();
        for entry in std::fs::read_dir(path)? {
            let Ok(entry) = entry else { continue };
            let Ok(metadata) = entry.metadata() else { continue };
            let name = entry.file_name().to_string_lossy().into_owned();
            if !show_hidden && self.is_hidden(&name, &metadata) {
                continue;
            }
            items.push(DirEntryItem {
                path: entry.path().to_string_lossy().into_owned(),
                is_dir: metadata.is_dir(),
                size: if metadata.is_dir() { 0 } else { metadata.len() },
                size_known: !metadata.is_dir(),
                modified: metadata.modified().ok(),
                original_path: None,
                name,
            });
        }
        items.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        Ok(items)
    }
}

/// Handing items to the rest of the system.
pub trait Shell: Send + Sync {
    /// Opens a file with its default application.
    fn open(&self, _path: &str) -> Result<(), PlatformError> {
        Err(PlatformError::Unsupported("opening a file with its application"))
    }

    /// Invokes a shell verb on an item (`properties`, `pintohome`…).
    fn invoke_verb(&self, _path: &str, _verb: &str) -> Result<(), PlatformError> {
        Err(PlatformError::Unsupported("shell verbs"))
    }
}

/// The user's language.
pub trait Culture: Send + Sync {
    /// The user's culture as a BCP 47 tag (`fr-FR`). Default: the POSIX locale variables.
    fn system_culture(&self) -> String {
        kubuno_drive_desktop_localization::detect_system_culture()
    }
}

/// Formatting dates and naming languages the way the user's system does. Default: nothing, so the callers
/// fall back to fixed formats (`dd/mm/yyyy`, `HH:MM`, English month names, the culture tag).
pub trait Locale: Send + Sync {
    /// The short date (the date part of .NET's "g").
    fn short_date(&self, _dt: &chrono::DateTime<chrono::Local>) -> Option<String> {
        None
    }

    /// The long date (.NET's "D").
    fn long_date(&self, _dt: &chrono::DateTime<chrono::Local>) -> Option<String> {
        None
    }

    /// The short time (the time part of "g").
    fn short_time(&self, _dt: &chrono::DateTime<chrono::Local>) -> Option<String> {
        None
    }

    /// The name of `month` (1 to 12) in the user's language.
    fn month_name(&self, _month: u32) -> Option<String> {
        None
    }

    /// The native display name of a culture (`fr-FR` → « français (France) »).
    fn language_display_name(&self, _culture: &str) -> Option<String> {
        None
    }
}

/// The user interface: what shows the app to the user and runs until it closes.
pub trait UiHost {
    /// Runs the interface for `launch`; returns the process exit code.
    fn run(&self, launch: &crate::app::Launch) -> i32;
}

/// The portable default of every service.
#[derive(Debug, Default, Clone, Copy)]
pub struct Portable;

impl FileSystem for Portable {}
impl Shell for Portable {}
impl Culture for Portable {}
impl Locale for Portable {}

/// The services of one platform, handed to [`crate::app::run`] by the entry point.
pub struct Platform {
    /// A short name for logs (`windows`, `portable`…).
    pub name: &'static str,
    pub file_system: Box<dyn FileSystem>,
    pub shell: Box<dyn Shell>,
    pub culture: Box<dyn Culture>,
    pub locale: Box<dyn Locale>,
}

impl Platform {
    /// The portable defaults: what Linux and macOS run today.
    pub fn portable() -> Platform {
        Platform {
            name: "portable",
            file_system: Box::new(Portable),
            shell: Box::new(Portable),
            culture: Box::new(Portable),
            locale: Box::new(Portable),
        }
    }
}

impl Default for Platform {
    fn default() -> Self {
        Platform::portable()
    }
}

static CURRENT: OnceLock<Platform> = OnceLock::new();

/// Registers the platform once, at start-up. A second call is ignored (returns `false`).
pub fn install(platform: Platform) -> bool {
    CURRENT.set(platform).is_ok()
}

/// The registered platform, or the portable defaults when none was (tests, tools).
pub fn current() -> &'static Platform {
    CURRENT.get_or_init(Platform::portable)
}

#[cfg(test)]
mod tests {
    use super::*;
    use kubuno_drive_desktop_localization::culture_from_env;

    #[test]
    fn culture_from_posix_variables() {
        let env = |pairs: &'static [(&'static str, &'static str)]| {
            move |name: &str| pairs.iter().find(|(k, _)| *k == name).map(|(_, v)| v.to_string())
        };
        assert_eq!(culture_from_env(env(&[("LANG", "fr_FR.UTF-8")])), "fr-FR");
        assert_eq!(culture_from_env(env(&[("LC_ALL", "de_DE@euro"), ("LANG", "fr_FR.UTF-8")])), "de-DE");
        assert_eq!(culture_from_env(env(&[("LANG", "C.UTF-8")])), "en-US");
        assert_eq!(culture_from_env(env(&[])), "en-US");
    }

    #[test]
    fn portable_listing_puts_folders_first_and_hides_dot_files() {
        let dir = std::env::temp_dir().join(format!("kubuno-drive-platform-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("b-folder")).expect("folder");
        std::fs::write(dir.join("a.txt"), b"x").expect("file");
        std::fs::write(dir.join(".hidden"), b"x").expect("hidden");
        let path = dir.to_string_lossy().into_owned();
        let names: Vec<String> = Portable.load_directory(&path, false).expect("list").into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["b-folder", "a.txt"]);
        assert_eq!(Portable.load_directory(&path, true).expect("list").len(), 3);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
