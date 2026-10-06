//! The Windows implementations of the platform extension points of `kubuno-drive-desktop-common`
//! (`platform.rs` there): what Windows does differently from the portable defaults.

use chrono::{DateTime, Datelike, Local, Timelike};
use kubuno_drive_desktop_common::platform::{Culture, FileSystem, Locale, Platform, PlatformError, Shell};
use windows::Win32::Foundation::SYSTEMTIME;

/// The Windows platform: every extension point overridden.
pub fn platform() -> Platform {
    Platform {
        name: "windows",
        file_system: Box::new(WindowsFileSystem),
        shell: Box::new(WindowsShell),
        culture: Box::new(WindowsCulture),
        locale: Box::new(WindowsLocale),
    }
}

/// Hidden means the hidden or system attribute, not a leading dot.
pub struct WindowsFileSystem;

impl FileSystem for WindowsFileSystem {
    fn is_hidden(&self, _name: &str, metadata: &std::fs::Metadata) -> bool {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
        metadata.file_attributes() & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM) != 0
    }
}

/// `ShellExecuteW` and the items' context-menu verbs.
pub struct WindowsShell;

impl Shell for WindowsShell {
    fn open(&self, path: &str) -> Result<(), PlatformError> {
        crate::view_models::shell_view_model::shell_open(path);
        Ok(())
    }

    fn invoke_verb(&self, path: &str, verb: &str) -> Result<(), PlatformError> {
        crate::view_models::shell_view_model::shell_verb(path, verb);
        Ok(())
    }
}

/// The Windows display language (`GetUserDefaultLocaleName`).
pub struct WindowsCulture;

impl Culture for WindowsCulture {
    fn system_culture(&self) -> String {
        use windows::Win32::Globalization::GetUserDefaultLocaleName;
        // LOCALE_NAME_MAX_LENGTH (winnt.h) — not exposed by the windows crate.
        const LOCALE_NAME_MAX_LENGTH: usize = 85;
        let mut buf = [0u16; LOCALE_NAME_MAX_LENGTH];
        // Returns the length **including** the trailing NUL, 0 on failure.
        let len = unsafe { GetUserDefaultLocaleName(&mut buf) };
        if len > 1 {
            return String::from_utf16_lossy(&buf[..(len - 1) as usize]);
        }
        kubuno_drive_desktop_localization::detect_system_culture()
    }
}

/// Dates, times, month and language names formatted by Windows (`GetDateFormatEx`, `GetTimeFormatEx`,
/// `GetLocaleInfoEx`), in the user's regional format.
pub struct WindowsLocale;

fn system_time(dt: &DateTime<Local>) -> SYSTEMTIME {
    SYSTEMTIME {
        wYear: dt.year() as u16,
        wMonth: dt.month() as u16,
        wDay: dt.day() as u16,
        wHour: dt.hour() as u16,
        wMinute: dt.minute() as u16,
        wSecond: dt.second() as u16,
        ..Default::default()
    }
}

fn date(dt: &DateTime<Local>, long: bool) -> Option<String> {
    use windows::Win32::Globalization::{GetDateFormatEx, DATE_LONGDATE, DATE_SHORTDATE};
    let st = system_time(dt);
    let flags = if long { DATE_LONGDATE } else { DATE_SHORTDATE };
    let mut buf = [0u16; 128];
    let n = unsafe { GetDateFormatEx(None, flags, Some(&st), None, Some(&mut buf), None) };
    (n > 1).then(|| String::from_utf16_lossy(&buf[..(n as usize - 1)]))
}

impl Locale for WindowsLocale {
    fn short_date(&self, dt: &DateTime<Local>) -> Option<String> {
        date(dt, false)
    }

    fn long_date(&self, dt: &DateTime<Local>) -> Option<String> {
        date(dt, true)
    }

    fn short_time(&self, dt: &DateTime<Local>) -> Option<String> {
        use windows::Win32::Globalization::{GetTimeFormatEx, TIME_NOSECONDS};
        let st = system_time(dt);
        let mut buf = [0u16; 64];
        let n = unsafe { GetTimeFormatEx(None, TIME_NOSECONDS, Some(&st), None, Some(&mut buf)) };
        (n > 1).then(|| String::from_utf16_lossy(&buf[..(n as usize - 1)]))
    }

    fn month_name(&self, month: u32) -> Option<String> {
        use windows::core::PCWSTR;
        use windows::Win32::Globalization::GetDateFormatEx;
        // The 15th of the requested month, any year.
        let st = SYSTEMTIME { wYear: 2000, wMonth: month as u16, wDay: 15, ..Default::default() };
        let fmt: Vec<u16> = "MMMM".encode_utf16().chain([0]).collect();
        let mut buf = [0u16; 64];
        let n = unsafe {
            GetDateFormatEx(
                PCWSTR::null(),
                windows::Win32::Globalization::ENUM_DATE_FORMATS_FLAGS(0),
                Some(&st),
                PCWSTR(fmt.as_ptr()),
                Some(&mut buf),
                None,
            )
        };
        (n > 0).then(|| String::from_utf16_lossy(&buf[..(n as usize - 1)]))
    }

    fn language_display_name(&self, culture: &str) -> Option<String> {
        use windows::core::HSTRING;
        use windows::Win32::Globalization::{GetLocaleInfoEx, LOCALE_SNATIVEDISPLAYNAME};
        let mut buf = [0u16; 256];
        let tag = HSTRING::from(culture);
        let n = unsafe {
            GetLocaleInfoEx(windows::core::PCWSTR(tag.as_ptr()), LOCALE_SNATIVEDISPLAYNAME, Some(&mut buf))
        };
        (n > 1).then(|| String::from_utf16_lossy(&buf[..(n as usize - 1)]))
    }
}
