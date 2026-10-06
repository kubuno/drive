//! Starting the app: what every OS entry point does, in one place.
//!
//! An entry point (`desktop/windows/kubuno-drive-desktop`, `desktop/linux/…`, `desktop/macos/…`) is a few
//! lines: it builds its [`Platform`] (the portable defaults, with what that OS overrides) and its
//! [`UiHost`], and calls [`run`].

use std::path::{Path, PathBuf};

use crate::platform::{self, Platform, UiHost};

/// What the app was asked to open, from its command line.
///
/// - `<folder>`: open this folder (the protocol contract of `Files.App.Launcher`); several are accepted;
/// - `--sample`: open the sample folder ([`crate::sample`]), created on first use in the sandbox
///   (`KUBUNO_SANDBOX_DIR`) or the temporary folder: a fixed, known tree for tests and screenshots;
/// - `--pos <x> <y>`: where to place the window (a tab torn out of another window).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Launch {
    pub folders: Vec<PathBuf>,
    pub sample: bool,
    pub position: Option<(i32, i32)>,
}

impl Launch {
    /// Parses the arguments, program name excluded. Unknown `--options` are ignored.
    pub fn parse(args: impl IntoIterator<Item = String>) -> Launch {
        let mut launch = Launch::default();
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--sample" => launch.sample = true,
                "--pos" => {
                    let x = args.next().and_then(|s| s.parse().ok());
                    let y = args.next().and_then(|s| s.parse().ok());
                    if let (Some(x), Some(y)) = (x, y) {
                        launch.position = Some((x, y));
                    }
                }
                other if other.starts_with("--") => {}
                folder => launch.folders.push(PathBuf::from(folder)),
            }
        }
        launch
    }

    /// The arguments of this process.
    pub fn from_env() -> Launch {
        Launch::parse(std::env::args().skip(1))
    }

    /// The folders to open at start-up, in order: the sample folder first when asked for (created if
    /// needed), then the folders named on the command line that exist.
    pub fn start_folders(&self) -> Vec<PathBuf> {
        let mut folders = Vec::new();
        if self.sample {
            match crate::sample::ensure_sample_folder() {
                Ok(folder) => folders.push(folder),
                Err(e) => tracing::warn!("the sample folder cannot be created: {e}"),
            }
        }
        folders.extend(self.folders.iter().filter(|f| f.is_dir()).cloned());
        folders
    }
}

/// Registers `platform`, sets the user's language, and runs `ui` until it closes; returns the exit code.
pub fn run(platform: Platform, ui: &dyn UiHost) -> i32 {
    let name = platform.name;
    if !platform::install(platform) {
        tracing::warn!("a platform was already registered; `{name}` is ignored");
    }
    let culture = platform::current().culture.system_culture();
    kubuno_drive_desktop_localization::set_culture(&culture);
    ui.run(&Launch::from_env())
}

/// The portable user interface: the start folder as text, listed, sorted and formatted by the same code
/// as the Windows window (`load_directory`, `sort_entries`, the settings' date format). It is what the app
/// shows on a system without a native window yet, and what tests run.
#[derive(Debug, Default, Clone, Copy)]
pub struct TextUi;

impl TextUi {
    /// The listing of `folder` as lines of text: a header, then one line per entry (name, type, size, date).
    pub fn render(folder: &Path) -> std::io::Result<Vec<String>> {
        use crate::view_models::shell_view_model::{sort_entries, SortColumn, SortGrouping};
        let mut entries = crate::data::items::load_directory(&folder.to_string_lossy())?;
        let settings = crate::services::settings::get();
        let grouping = SortGrouping::of(settings.default_sort_files_first, settings.default_sort_directories_alongside_files);
        sort_entries(&mut entries, SortColumn::Name, true, grouping);
        let mut lines = vec![format!("Kubuno Drive — {}", folder.display())];
        for e in &entries {
            lines.push(format!("{:<40} {:<24} {:>12}  {}", e.name, e.type_text(), e.size_text(), e.modified_text()));
        }
        lines.push(format!("{} élément(s)", entries.len()));
        Ok(lines)
    }
}

impl UiHost for TextUi {
    fn run(&self, launch: &Launch) -> i32 {
        let folder = launch
            .start_folders()
            .into_iter()
            .next()
            .or_else(|| std::env::current_dir().ok())
            .unwrap_or_else(|| PathBuf::from("."));
        match TextUi::render(&folder) {
            Ok(lines) => {
                for line in lines {
                    println!("{line}");
                }
                0
            }
            Err(e) => {
                eprintln!("{}: {e}", folder.display());
                1
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_folders_sample_and_position() {
        let launch = Launch::parse(args(&["--sample", "C:\\Users", "--pos", "10", "-20", "--unknown", "/tmp"]));
        assert!(launch.sample);
        assert_eq!(launch.position, Some((10, -20)));
        assert_eq!(launch.folders, [PathBuf::from("C:\\Users"), PathBuf::from("/tmp")]);
        assert_eq!(Launch::parse(args(&["--pos", "x"])), Launch::default());
    }
}
