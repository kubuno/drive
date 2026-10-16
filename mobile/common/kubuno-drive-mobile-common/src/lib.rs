//! Kubuno Drive for mobile - the app, portable (no OS, no window system).
//!
//! The app is a set of `.kbview` screens (`views/`, edited in Visual Studio like every Kubuno view) rendered by the
//! shared Kubuno mobile renderer (`kubuno-mobile-render`, core repository). The Android and iOS entry points
//! (`../android`, `../ios`) hand [`APP`] to the shared shell of their OS.
//!
//! Migration status: the screens are converted; the app's behaviour (its data and server calls) is still to be
//! migrated from the reference Kotlin app that lived in `mobile/` before this layout (kept in the git history).

use kubuno_mobile_render::App;

/// The `browser.kbview` screen.
pub const BROWSER: &str = include_str!("views/browser.kbview");
/// The `account.kbview` screen.
pub const ACCOUNT: &str = include_str!("views/account.kbview");
/// The `browser_grid.kbview` screen.
pub const BROWSER_GRID: &str = include_str!("views/browser_grid.kbview");
/// The `device_accounts.kbview` screen.
pub const DEVICE_ACCOUNTS: &str = include_str!("views/device_accounts.kbview");
/// The `drawer.kbview` screen.
pub const DRAWER: &str = include_str!("views/drawer.kbview");
/// The `empty_folder.kbview` screen.
pub const EMPTY_FOLDER: &str = include_str!("views/empty_folder.kbview");
/// The `info_sheet.kbview` screen.
pub const INFO_SHEET: &str = include_str!("views/info_sheet.kbview");
/// The `login.kbview` screen.
pub const LOGIN: &str = include_str!("views/login.kbview");
/// The `move_sheet.kbview` screen.
pub const MOVE_SHEET: &str = include_str!("views/move_sheet.kbview");
/// The `newfolder_dialog.kbview` screen.
pub const NEWFOLDER_DIALOG: &str = include_str!("views/newfolder_dialog.kbview");
/// The `onboarding_server.kbview` screen.
pub const ONBOARDING_SERVER: &str = include_str!("views/onboarding_server.kbview");
/// The `onboarding_totp.kbview` screen.
pub const ONBOARDING_TOTP: &str = include_str!("views/onboarding_totp.kbview");
/// The `recent.kbview` screen.
pub const RECENT: &str = include_str!("views/recent.kbview");
/// The `rename_dialog.kbview` screen.
pub const RENAME_DIALOG: &str = include_str!("views/rename_dialog.kbview");
/// The `search.kbview` screen.
pub const SEARCH: &str = include_str!("views/search.kbview");
/// The `settings.kbview` screen.
pub const SETTINGS: &str = include_str!("views/settings.kbview");
/// The `sheet_actions.kbview` screen.
pub const SHEET_ACTIONS: &str = include_str!("views/sheet_actions.kbview");
/// The `sort_sheet.kbview` screen.
pub const SORT_SHEET: &str = include_str!("views/sort_sheet.kbview");
/// The `starred.kbview` screen.
pub const STARRED: &str = include_str!("views/starred.kbview");
/// The `transfers.kbview` screen.
pub const TRANSFERS: &str = include_str!("views/transfers.kbview");
/// The `trash.kbview` screen.
pub const TRASH: &str = include_str!("views/trash.kbview");

/// Every screen, in a tap-to-advance order (the home screen first).
pub const VIEWS: &[&str] = &[BROWSER, ACCOUNT, BROWSER_GRID, DEVICE_ACCOUNTS, DRAWER, EMPTY_FOLDER, INFO_SHEET, LOGIN, MOVE_SHEET, NEWFOLDER_DIALOG, ONBOARDING_SERVER, ONBOARDING_TOTP, RECENT, RENAME_DIALOG, SEARCH, SETTINGS, SHEET_ACTIONS, SORT_SHEET, STARRED, TRANSFERS, TRASH];

/// Register what the app's screens need from the renderer (its host controls and images) - nothing yet. The shell
/// calls it once, on its UI thread, before the first frame (through [`APP`]).
pub fn setup() {}

/// The Kubuno Drive app, as the shells run it.
pub const APP: App = App { id: "drive", label: "Kubuno Drive", views: VIEWS, setup, on_event: None, view_index: None };

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_screen_renders() {
        setup();
        for src in VIEWS {
            assert!(kubuno_mobile_render::render_view(src, 1080, 2340, None, None).is_some());
        }
    }
}
