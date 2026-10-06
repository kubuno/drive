# Kubuno Drive — desktop file manager

The desktop app of Kubuno Drive: a native Windows file manager built in Rust
with a pure Win32 UI (Direct2D / DirectWrite / DirectComposition, Mica
backdrop) — no web view, no UI framework.

## Credits

This code base is a Rust port of, and is heavily inspired by,
**[Files](https://github.com/files-community/Files)** (files-community, MIT
license) — the modern file manager for Windows. The application structure,
views, controls, vector icon geometries, localization strings and behaviours
mirror the original C#/WinUI 3 implementation; `docs/ARCHITECTURE.md` maps
each Rust module to its C# counterpart, and `docs/PORTING.md` is the detailed
porting journal. Huge thanks to the Files community for their outstanding
work.

The crates are licensed MIT, like the original project: see [`LICENSE-MIT`](LICENSE-MIT), which keeps the
Files Community's copyright notice. (The rest of the drive repository is AGPL-3.0-or-later.)

## Layout

| Crate | Role |
|---|---|
| `crates/kubuno-drive-desktop` | The application: window, tabs, views, actions, settings |
| `crates/kubuno-drive-desktop-app-storage` | Shell/storage layer (IShellItem, IFileOperation, watchers, FTP) |
| `crates/kubuno-drive-desktop-core-storage` | Storage model traits (OwlCore.Storage model) |
| `crates/kubuno-drive-desktop-localization` | 49 cultures ported from the original `.resw` resources |

The custom Direct2D controls and the shared helpers ported with them (`kubuno-drive-desktop-app-controls`,
`kubuno-drive-desktop-shared`) became the painting surface of the whole Kubuno desktop framework: they live in
[`kubuno/desktop`](https://github.com/kubuno/desktop) (`windows/src/crates/`, MIT as well) and come from there, like
`kubuno-desktop-ui`, `kubuno-desktop-controls` and `kubuno-desktop-app-storage`.

`suppa/` vendors the `suppaftp` crate (the build uses the crates.io release). The binary is `drive.exe`.

## Build

This folder is a Cargo workspace of its own, independent of the server's (the repository root). The framework crates
come from `https://github.com/kubuno/desktop` at the tag named in `Cargo.toml` (`[workspace.dependencies]`, one
tag for all of them, pinned to a commit by `Cargo.lock`) and are linked statically: `drive.exe` needs no DLL beside
it. From this folder (Windows, Rust stable with the MSVC toolchain):

```powershell
cargo build --release -p kubuno-drive-desktop
target\release\drive.exe [folder-to-open]
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

In Visual Studio, the crates are in the repository's solution, `Kubuno.Drive.slnx`, under the **Desktop** folder
(`Kubuno.Drive.Desktop` and its engine crates).

## History

The app was developed in `kubuno/desktop` (`windows/src/drive`) and moved here with its history in October 2026,
when every module repository started to hold all its clients (server, web frontend, desktop, and later mobile).
