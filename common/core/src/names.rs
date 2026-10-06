//! File and folder names: the one rule every Drive client applies (SC-3, decision Q4 of vskubuno
//! `docs/SHARED-CORES.md`).
//!
//! A name is judged for a [`Profile`]: the server's (what it stores), one operating system's (what that
//! system can write to disk) or [`Profile::Portable`] (what every one of them can write). The server profile
//! returns [`Verdict::PortableWarning`] for a name it accepts but some system cannot store, so a client can
//! warn, map the name locally, or (decision Q4) refuse it for new names.
//!
//! Every function is total: no panic, no I/O, no clock (the conflict-copy stamp is a parameter).

use unicode_normalization::UnicodeNormalization;

/// The longest name, in UTF-8 bytes (Linux, macOS and the server); Windows counts 255 UTF-16 units, which
/// a 255-byte name never exceeds.
pub const MAX_NAME_BYTES: usize = 255;

/// The characters Windows refuses in a name, besides the separators and the control characters.
const WINDOWS_RESERVED_CHARS: [char; 7] = ['<', '>', ':', '"', '|', '?', '*'];

/// Windows' reserved device names (case-insensitive, with or without an extension).
const WINDOWS_DEVICE_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Whose rules a name is judged by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Profile {
    /// What the Drive server stores: one plain path segment of at most 255 bytes.
    Server,
    /// What Windows (NTFS, ReFS, FAT) can store.
    Windows,
    /// What macOS (APFS, HFS+) can store; `:` is refused, the Finder shows it as `/`.
    MacOs,
    /// What Linux file systems (ext4, btrfs, xfs) can store.
    Linux,
    /// What every system above can store: the strictest of all.
    Portable,
}

impl Profile {
    /// The profile's stable code (`server`, `windows`, `macos`, `linux`, `portable`), as in the vectors.
    pub fn code(self) -> &'static str {
        match self {
            Profile::Server => "server",
            Profile::Windows => "windows",
            Profile::MacOs => "macos",
            Profile::Linux => "linux",
            Profile::Portable => "portable",
        }
    }

    /// The profile of a code (see [`Profile::code`]).
    pub fn from_code(code: &str) -> Option<Profile> {
        match code {
            "server" => Some(Profile::Server),
            "windows" => Some(Profile::Windows),
            "macos" => Some(Profile::MacOs),
            "linux" => Some(Profile::Linux),
            "portable" => Some(Profile::Portable),
            _ => None,
        }
    }

    /// The profile of the system this code is compiled for (Linux for any other Unix).
    pub fn native() -> Profile {
        if cfg!(windows) {
            Profile::Windows
        } else if cfg!(target_os = "macos") || cfg!(target_os = "ios") {
            Profile::MacOs
        } else {
            Profile::Linux
        }
    }
}

/// Why a name is refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum InvalidReason {
    /// The empty name.
    Empty,
    /// `.` or `..`.
    DotName,
    /// Longer than [`MAX_NAME_BYTES`] bytes (UTF-16 units on Windows).
    TooLong,
    /// A NUL character.
    NulChar,
    /// A path separator (`/`, and `\` for the server, Windows and the portable profile).
    Separator,
    /// A control character (U+0001 to U+001F).
    ControlChar,
    /// One of `< > : " | ? *` (only `:` on macOS).
    ReservedChar,
    /// A trailing dot or space (Windows silently drops them).
    TrailingDotOrSpace,
    /// A Windows device name (`CON`, `NUL`, `COM1`, `LPT1`… with or without an extension).
    ReservedDeviceName,
}

impl InvalidReason {
    /// The reason's stable code, as in the vectors and API error details.
    pub fn code(self) -> &'static str {
        match self {
            InvalidReason::Empty => "empty",
            InvalidReason::DotName => "dot-name",
            InvalidReason::TooLong => "too-long",
            InvalidReason::NulChar => "nul-char",
            InvalidReason::Separator => "separator",
            InvalidReason::ControlChar => "control-char",
            InvalidReason::ReservedChar => "reserved-char",
            InvalidReason::TrailingDotOrSpace => "trailing-dot-or-space",
            InvalidReason::ReservedDeviceName => "reserved-device-name",
        }
    }
}

/// The verdict on a name for a profile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// The profile stores the name, and so does every system.
    Valid,
    /// The profile refuses the name; the first failing rule, in the order of [`InvalidReason`].
    Invalid(InvalidReason),
    /// The profile stores the name but some system cannot: every portable rule it breaks, in order.
    PortableWarning(Vec<InvalidReason>),
}

impl Verdict {
    /// Whether the profile stores the name (valid or with a portable warning).
    pub fn is_accepted(&self) -> bool {
        !matches!(self, Verdict::Invalid(_))
    }

    /// The verdict's stable code: `valid`, `invalid` or `portable-warning`.
    pub fn code(&self) -> &'static str {
        match self {
            Verdict::Valid => "valid",
            Verdict::Invalid(_) => "invalid",
            Verdict::PortableWarning(_) => "portable-warning",
        }
    }
}

/// Every rule of `profile` that `name` breaks, in the order of [`InvalidReason`].
fn violations(name: &str, profile: Profile) -> Vec<InvalidReason> {
    let mut out = Vec::new();
    if name.is_empty() {
        out.push(InvalidReason::Empty);
        return out;
    }
    if name == "." || name == ".." {
        out.push(InvalidReason::DotName);
        return out;
    }
    let too_long = match profile {
        Profile::Windows => name.encode_utf16().count() > MAX_NAME_BYTES,
        _ => name.len() > MAX_NAME_BYTES,
    };
    if too_long {
        out.push(InvalidReason::TooLong);
    }
    if name.contains('\0') {
        out.push(InvalidReason::NulChar);
    }
    let backslash_separates = matches!(
        profile,
        Profile::Server | Profile::Windows | Profile::Portable
    );
    if name.contains('/') || (backslash_separates && name.contains('\\')) {
        out.push(InvalidReason::Separator);
    }
    let windows_rules = matches!(profile, Profile::Windows | Profile::Portable);
    if windows_rules && name.chars().any(|c| ('\u{1}'..='\u{1f}').contains(&c)) {
        out.push(InvalidReason::ControlChar);
    }
    let reserved_char = match profile {
        Profile::Windows | Profile::Portable => {
            name.chars().any(|c| WINDOWS_RESERVED_CHARS.contains(&c))
        }
        Profile::MacOs => name.contains(':'),
        Profile::Server | Profile::Linux => false,
    };
    if reserved_char {
        out.push(InvalidReason::ReservedChar);
    }
    if windows_rules && (name.ends_with('.') || name.ends_with(' ')) {
        out.push(InvalidReason::TrailingDotOrSpace);
    }
    if windows_rules && is_windows_device_name(name) {
        out.push(InvalidReason::ReservedDeviceName);
    }
    out
}

/// Whether the part of `name` before its first dot, trailing spaces ignored, is a Windows device name.
fn is_windows_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name).trim_end_matches(' ');
    WINDOWS_DEVICE_NAMES
        .iter()
        .any(|d| d.eq_ignore_ascii_case(stem))
}

/// The verdict on `name` for `profile`.
///
/// For a system profile (and [`Profile::Portable`]) the answer is [`Verdict::Valid`] or
/// [`Verdict::Invalid`]. For [`Profile::Server`] a name the server stores but some system cannot is a
/// [`Verdict::PortableWarning`] listing the portable rules it breaks.
pub fn verdict(name: &str, profile: Profile) -> Verdict {
    if let Some(first) = violations(name, profile).first() {
        return Verdict::Invalid(*first);
    }
    if profile == Profile::Server {
        let portable = violations(name, Profile::Portable);
        if !portable.is_empty() {
            return Verdict::PortableWarning(portable);
        }
    }
    Verdict::Valid
}

/// Whether `name` is one plain path segment: not empty, not `.` or `..`, without `/`, `\` or NUL. The
/// weakest rule, for names already stored (any length) that become a segment of a path on disk.
pub fn is_plain_segment(name: &str) -> bool {
    !(name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', '\0']))
}

/// The key two names are compared by when the file system ignores case and Unicode normalisation (Windows,
/// macOS): the name in Unicode NFC, lower-cased. `A.txt`/`a.txt` and an NFD `é` and its NFC form share a
/// key.
pub fn comparison_key(name: &str) -> String {
    name.nfc().collect::<String>().to_lowercase()
}

/// How names are compared when looking for a free one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CaseRule {
    /// Byte for byte (the server, Linux).
    Sensitive,
    /// By [`comparison_key`] (Windows, macOS).
    Insensitive,
}

impl CaseRule {
    /// The rule of the system this code is compiled for.
    pub fn native() -> CaseRule {
        if cfg!(any(windows, target_os = "macos", target_os = "ios")) {
            CaseRule::Insensitive
        } else {
            CaseRule::Sensitive
        }
    }

    fn same(self, a: &str, b: &str) -> bool {
        match self {
            CaseRule::Sensitive => a == b,
            CaseRule::Insensitive => a == b || comparison_key(a) == comparison_key(b),
        }
    }
}

/// Splits a FILE name into its stem and its extension, the dot included in the extension: `a.tar.gz` →
/// (`a.tar`, `.gz`). A leading dot is not an extension (`.gitignore` → (`.gitignore`, ``)).
pub fn split_extension(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(0) | None => (name, ""),
        Some(pos) => (&name[..pos], &name[pos..]),
    }
}

/// `name` numbered `n`: `report (2).pdf` for a file (the number goes before the extension), `Documents (2)`
/// for a folder (`is_folder`, the number goes at the end).
pub fn numbered_name(name: &str, n: u32, is_folder: bool) -> String {
    if is_folder {
        return format!("{name} ({n})");
    }
    let (stem, ext) = split_extension(name);
    format!("{stem} ({n}){ext}")
}

/// `desired` itself when `is_taken` says it is free, otherwise the first free numbered name from 2 on
/// (see [`numbered_name`]). `None` only when every number up to `u32::MAX` is taken.
pub fn unique_name(
    desired: &str,
    is_folder: bool,
    mut is_taken: impl FnMut(&str) -> bool,
) -> Option<String> {
    if !is_taken(desired) {
        return Some(desired.to_string());
    }
    (2..=u32::MAX)
        .map(|n| numbered_name(desired, n, is_folder))
        .find(|candidate| !is_taken(candidate))
}

/// [`unique_name`] among the names of `existing`, compared by `case`.
pub fn unique_name_among<S: AsRef<str>>(
    desired: &str,
    is_folder: bool,
    existing: &[S],
    case: CaseRule,
) -> String {
    let taken = |candidate: &str| existing.iter().any(|e| case.same(e.as_ref(), candidate));
    // `existing` is finite: at most `existing.len() + 1` candidates can be tried before a free one.
    unique_name(desired, is_folder, taken)
        .unwrap_or_else(|| numbered_name(desired, u32::MAX, is_folder))
}

/// When and where a conflict copy was made: the caller reads the clock and the machine name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConflictStamp<'a> {
    /// The machine whose copy lost (its host name).
    pub machine: &'a str,
    pub year: i32,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
}

/// The name of the copy a client keeps when its version of `name` conflicts with the server's:
/// `report (conflit PC-1 2026-10-06 14-05).pdf` (folders: the stamp at the end). Characters of the machine
/// name that some system refuses become `-`, so the copy is always as portable as `name`.
pub fn conflict_copy_name(name: &str, is_folder: bool, stamp: &ConflictStamp<'_>) -> String {
    let machine: String = stamp
        .machine
        .chars()
        .map(|c| {
            if c == '/'
                || c == '\\'
                || c == '\0'
                || ('\u{1}'..='\u{1f}').contains(&c)
                || WINDOWS_RESERVED_CHARS.contains(&c)
            {
                '-'
            } else {
                c
            }
        })
        .collect();
    let machine = machine.trim();
    let machine = if machine.is_empty() {
        "desktop"
    } else {
        machine
    };
    let label = format!(
        "conflit {machine} {:04}-{:02}-{:02} {:02}-{:02}",
        stamp.year, stamp.month, stamp.day, stamp.hour, stamp.minute
    );
    if is_folder {
        return format!("{name} ({label})");
    }
    let (stem, ext) = split_extension(name);
    format!("{stem} ({label}){ext}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_accepts_what_windows_refuses_with_a_warning() {
        assert_eq!(
            verdict("a:b?.txt", Profile::Server),
            Verdict::PortableWarning(vec![InvalidReason::ReservedChar])
        );
        assert_eq!(
            verdict("a:b.txt", Profile::Windows),
            Verdict::Invalid(InvalidReason::ReservedChar)
        );
        assert_eq!(verdict("a:b.txt", Profile::Linux), Verdict::Valid);
    }

    #[test]
    fn device_names_with_extension_and_case() {
        assert_eq!(
            verdict("con.txt", Profile::Windows),
            Verdict::Invalid(InvalidReason::ReservedDeviceName)
        );
        assert_eq!(
            verdict("Lpt9", Profile::Portable),
            Verdict::Invalid(InvalidReason::ReservedDeviceName)
        );
        assert_eq!(verdict("console.txt", Profile::Windows), Verdict::Valid);
        assert_eq!(verdict("COM10", Profile::Windows), Verdict::Valid);
    }

    #[test]
    fn length_counts_bytes_or_utf16_units() {
        let e_acute = "é".repeat(128); // 256 bytes, 128 UTF-16 units
        assert_eq!(
            verdict(&e_acute, Profile::Linux),
            Verdict::Invalid(InvalidReason::TooLong)
        );
        assert_eq!(verdict(&e_acute, Profile::Windows), Verdict::Valid);
        assert_eq!(
            verdict(&e_acute, Profile::Server),
            Verdict::Invalid(InvalidReason::TooLong)
        );
    }

    #[test]
    fn numbering_and_keys() {
        assert_eq!(
            unique_name_among("a.txt", false, &["a.txt", "a (2).txt"], CaseRule::Sensitive),
            "a (3).txt"
        );
        assert_eq!(
            unique_name_among("A.TXT", false, &["a.txt"], CaseRule::Insensitive),
            "A (2).TXT"
        );
        assert_eq!(
            unique_name_among("A.TXT", false, &["a.txt"], CaseRule::Sensitive),
            "A.TXT"
        );
        assert_eq!(
            unique_name_among("v1.2", true, &["v1.2"], CaseRule::Sensitive),
            "v1.2 (2)"
        );
        assert_eq!(
            comparison_key("E\u{301}t\u{e9}"),
            comparison_key("\u{e9}T\u{c9}")
        );
    }
}
