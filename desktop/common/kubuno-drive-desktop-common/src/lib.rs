//! Kubuno Drive desktop, the portable app (`desktop/common`).
//!
//! Everything the desktop file manager does that no operating system does differently: the listed item
//! and the folder listing, the settings and their store, the layouts, sort and grouping of a tab, the date
//! formatting, the file operation history, the launch arguments and the sample folder. What only an OS can
//! do goes through the extension points of [`platform`], which have portable defaults: the app builds and
//! runs anywhere with nothing registered ([`app::run`] with [`platform::Platform::portable`] and
//! [`app::TextUi`]). `desktop/windows` overrides them with Win32 and paints the window with Direct2D;
//! `desktop/linux` and `desktop/macos` run the defaults today.
//!
//! The module tree mirrors `Files.App` (C#) like the Windows crate's, so a module keeps its path when it
//! moves here (`crate::services::settings`, `crate::view_models::shell_view_model`…): the Windows crate
//! re-exports each one at the same place.
#![allow(clippy::module_inception)]

pub mod app;
pub mod platform;
pub mod sample;

/// Port of `Files.App/Data/` (the portable part).
pub mod data {
    pub mod items;
}

/// Port of `Files.App/Helpers/` (the portable part).
pub mod helpers {
    pub mod layout;

    /// Compatibility re-export: the historical `crate::helpers::layout_preferences::…` API stays identical
    /// after the split into `helpers/layout/` (mirrors `Helpers/Layout/LayoutPreferencesItem.cs` +
    /// `LayoutPreferencesManager.cs`).
    pub mod layout_preferences {
        pub use super::layout::layout_preferences_item::LayoutPreferences;
        pub use super::layout::layout_preferences_manager::{get, set};
    }
}

/// Port of `Files.App/Services/` (the portable part).
pub mod services {
    pub mod date_time_formatter;
    pub mod settings;
}

/// Port of `Files.App/Utils/` (the portable part).
pub mod utils {
    pub mod storage_history;
}

/// Port of `Files.App/ViewModels/` (the portable part).
pub mod view_models {
    pub mod shell_view_model;
}
