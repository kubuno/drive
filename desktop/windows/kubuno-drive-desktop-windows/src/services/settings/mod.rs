//! Port of `Files.App/Services/Settings/`. The settings themselves (`AppSettings`, the store, the value
//! enums) are portable and live in desktop/common (`kubuno-drive-desktop-common`); this module re-exports
//! them and adds the services built on Windows types.

pub use kubuno_drive_desktop_common::services::settings::*;

// Settings sub-services that need Windows: a Direct2D colour, a Win32 GUID.
pub mod appearance_settings_service;
pub mod general_settings_service;

pub use appearance_settings_service::{app_theme_font_override, parse_color};
pub use general_settings_service::user_id;
