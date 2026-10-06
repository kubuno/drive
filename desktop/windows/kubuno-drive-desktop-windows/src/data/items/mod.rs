//! Port of `Files.App/Data/Items/`: the Home page's data — quick access,
//! drives, recent files (`DirEntryItem` ≈ `ListedItem`, `DriveItem`,
//! `WidgetsListedItem`).

use windows::core::PWSTR;
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::UI::Shell::{SHGetKnownFolderPath, KF_FLAG_DEFAULT};

pub mod branch_item;
pub mod drive_item;
pub mod home_model;
// The listed item and the size format are portable (desktop/common).
pub use kubuno_drive_desktop_common::data::items::{format_bytes_fr, listed_item};
pub mod quick_access_item;
pub mod shelf_item;
pub mod shell_new_entry;
pub mod shell_new_entry_extensions;
pub mod widget_recent_item;

pub use branch_item::BranchItem;
pub use drive_item::{load_drives, DriveItem};
pub use home_model::HomeModel;
pub use listed_item::{load_directory, DirEntryItem};
pub use quick_access_item::{load_quick_access, QuickAccessItem, QuickAccessKind};
pub use shelf_item::ShelfItem;
pub use shell_new_entry_extensions::create_from_template;
pub use widget_recent_item::{load_recent_files, RecentFileItem};

/// The path of a known folder (`SHGetKnownFolderPath`). Helper shared by
/// quick access and recent files.
pub(crate) fn known_folder_path(id: &windows::core::GUID) -> Option<String> {
    unsafe {
        let pwstr: PWSTR = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
        let path = pwstr.to_string().ok();
        CoTaskMemFree(Some(pwstr.as_ptr() as *const _));
        path
    }
}

