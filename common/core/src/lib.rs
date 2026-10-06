//! Kubuno Drive shared core (lot SC-3 of vskubuno `docs/SHARED-CORES.md`).
//!
//! Sans-IO: names in, verdicts and names out. No network, database, file system, clock or UI, so the
//! server, the desktop app (every OS) and, through the conformance vectors of `common/vectors`, the web and
//! mobile clients apply the same rules.
//!
//! - [`names`]: the verdict on a file or folder name for a platform [`Profile`](names::Profile) (the
//!   server's, Windows', macOS', Linux' or the portable intersection), the case and Unicode comparison key,
//!   the `name (2).ext` numbering and the conflict-copy name.
#![forbid(unsafe_code)]

pub mod names;

pub use names::{
    comparison_key, conflict_copy_name, is_plain_segment, numbered_name, split_extension,
    unique_name, unique_name_among, verdict, CaseRule, ConflictStamp, InvalidReason, Profile,
    Verdict, MAX_NAME_BYTES,
};
