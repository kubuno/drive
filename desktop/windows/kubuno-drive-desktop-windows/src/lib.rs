//! Kubuno Drive on Windows: the Rust port of `Files.App` with a pure Win32 UI (windows-rs + Direct2D +
//! DirectComposition, Mica backdrop), over the portable app of desktop/common (`kubuno-drive-desktop-common`).
//!
//! This crate holds only what Windows does differently: the window and everything painted in it, the shell
//! (IShellItem, context menus, known folders, the Recycle Bin), the storage layer, and the Windows
//! implementations of the platform extension points ([`platform`]). The entry point `drive.exe`
//! (`desktop/windows/kubuno-drive-desktop`) registers them and runs [`WindowsUi`].

// The module tree mirrors the folders of Files (`Files.App/<Folder>/<Folder>.cs`)
// one to one, as the port requires — which puts `foo/foo.rs` under `foo`.
#![allow(clippy::module_inception)]

// The module tree mirrors `Files.App` (C#), so each Rust file maps to its
// counterpart: `data/` ↔ `Data/`, `services/` ↔ `Services/`, `utils/` ↔
// `Utils/`, `user_controls/` ↔ `UserControls/`, `views/` ↔ `Views/`,
// `view_models/` ↔ `ViewModels/`. Detailed mapping: `docs/ARCHITECTURE.md`.
// Only `ui.rs` and `graphics.rs` have no counterpart: they play the role of
// the XAML runtime (layout + Direct2D painting). The portable modules (settings,
// the listed item, layouts and sort, date formatting, history) live in
// desktop/common and are re-exported at the same paths.
mod actions;
mod data;
mod dialogs;
mod graphics { pub use kubuno_drive_desktop_app_controls::Renderer; }
mod helpers;
mod main_window;
pub mod platform;
mod services;
mod styles;
mod ui;
mod user_controls;
mod utils;
mod view_models;
mod views;

use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::HiDpi::{
    SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};

/// The Windows user interface: the main window, its message loop and the splash screen before it.
pub struct WindowsUi;

impl kubuno_drive_desktop_common::platform::UiHost for WindowsUi {
    fn run(&self, launch: &kubuno_drive_desktop_common::app::Launch) -> i32 {
        run_window(launch)
    }
}

fn run_window(launch: &kubuno_drive_desktop_common::app::Launch) -> i32 {
    // The splash screen, first of all: it paints on its own thread while the rest starts, and
    // fades out once the main window is on screen. Not for a tab torn out into a new window
    // (`--pos x y`): that is Drive already running, handing over a tab.
    let splash = kubuno_desktop_ui::splash::SplashScreen::new()
        .artwork(kubuno_desktop_ui::splash::Artwork::Drive)
        .product("Kubuno Drive")
        .version(env!("CARGO_PKG_VERSION"))
        .license(env!("CARGO_PKG_LICENSE"))
        .credits("Explorateur de fichiers dérivé de Files (MIT). Merci à ses contributeurs.")
        .enabled(launch.position.is_none())
        .show();

    // No console (GUI subsystem): tracing, println!s and panics go to the debugger's Output window
    // or to %LOCALAPPDATA%\Kubuno\logs\<exe>.log, and a panic shows a dialog. Drive runs its own
    // window loop, so it installs the sink the shared host would otherwise install.
    kubuno_desktop_controls::host::diagnostics::install(&kubuno_desktop_controls::host::diagnostics::exe_name(), true);
    kubuno_desktop_controls::host::diagnostics::set_display_name("Drive");

    // The language follows the Windows display language (49 cultures): set by the common start-up
    // (`app::run`) from the platform's culture (`platform::WindowsCulture`).
    splash.step("Chargement de la langue…", 0.15);

    // `App.OnLaunched` logs to `debug.log` (FileLogger); `OpenLogFile` opens it.
    let log_path = actions::open::log_file_path();
    if let Some(dir) = log_path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    kubuno_drive_desktop_shared::logger::FileLogger::new(&log_path)
        .log(kubuno_drive_desktop_shared::logger::LogLevel::Information, "App launched.");

    unsafe {
        // Per-monitor V2: real pixels for rendering, input, and metrics.
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        // The UI thread is STA, as the Shell requires.
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }

    // The main window loads the settings, the drives and the quick-access folders, and opens the
    // folders of the command line (`launch`).
    splash.step("Chargement des lecteurs et des accès rapides…", 0.35);
    let _window = match main_window::MainWindow::create(launch) {
        Ok(w) => w,
        Err(e) => {
            tracing::error!("failed to create the main window: {e}");
            return 1;
        }
    };
    splash.step("Ouverture de l'explorateur…", 0.9);

    main_window::run_message_loop()
}
