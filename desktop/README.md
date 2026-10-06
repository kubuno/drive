# Kubuno Drive — desktop app

The native desktop file manager of the drive module: a Rust port of **[Files](https://github.com/files-community/Files)**
(files-community, MIT), one Cargo workspace for every operating system (`Cargo.toml` here), independent of the
server's (`../server`).

```
desktop/
  common/    the COMPLETE app, portable: model, settings, view models, date formatting, file history,
             localisation (49 cultures), storage abstractions, start-up, and the platform extension points
  windows/   ONLY what Windows does differently, and drive.exe, the entry point that registers it
  linux/     the Linux entry point: the common app with the portable platform
  macos/     the macOS entry point: the common app with the portable platform
  docs/      ARCHITECTURE.md (Rust ↔ C# map, extension points), PORTING.md (porting journal, French)
```

| Crate | Folder | Role |
|---|---|---|
| `kubuno-drive-desktop-common` | `common/` | The app: `DirEntryItem` and the folder listing, `AppSettings` and its store, layouts, sort and grouping, date formatting, storage history, `app::run`, `--sample`, and `platform` (the extension points) |
| `kubuno-drive-desktop-core-storage` | `common/` | Storage model traits (port of `Files.Core.Storage`) |
| `kubuno-drive-desktop-localization` | `common/` | 49 cultures from the original `.resw` resources |
| `kubuno-drive-desktop-windows` | `windows/` | The Win32 window painted with Direct2D, shell integration, the Windows implementations of the extension points |
| `kubuno-drive-desktop-app-storage` | `windows/` | Shell/storage layer (IShellItem, IFileOperation, watchers, FTP) |
| `kubuno-drive-desktop` | `windows/` | `drive.exe`: registers the Windows platform and runs the app |
| `kubuno-drive-desktop-linux`, `kubuno-drive-desktop-macos` | `linux/`, `macos/` | `kubuno-drive-desktop`: the app with the portable defaults |

The app also uses `kubuno-drive-core` (`../common/core`), the name rules every Drive client shares with the server:
the `name (2).ext` numbering of new and copied items and the comparison key of bulk renames come from it.

`common/vendor/` keeps the `suppaftp` sources for reference (the build uses the crates.io release).

## Platform extension points

Everything is written once in `common/`; what only an operating system can do goes through the traits of
`kubuno_drive_desktop_common::platform`, each with a portable default, so the common app builds and runs anywhere
with nothing registered. An OS folder overrides only what it does better and registers it in its entry point:

```rust
// windows/kubuno-drive-desktop/src/main.rs
fn main() {
    let code = kubuno_drive_desktop_common::app::run(
        kubuno_drive_desktop_windows::platform::platform(),   // FileSystem, Shell, Culture, Locale for Windows
        &kubuno_drive_desktop_windows::WindowsUi,              // the Win32 window
    );
    std::process::exit(code);
}
```

| Trait | Portable default | Windows override |
|---|---|---|
| `FileSystem` | `std::fs`, dot files hidden | hidden and system attributes |
| `Shell` | unsupported | `ShellExecuteW`, context-menu verbs |
| `Culture` | `LC_ALL` / `LC_MESSAGES` / `LANG` | `GetUserDefaultLocaleName` |
| `Locale` | fixed formats, English month names | `GetDateFormatEx`, `GetTimeFormatEx`, `GetLocaleInfoEx` |
| `UiHost` | `app::TextUi` (the start folder as text) | `WindowsUi` (the Win32 window, Direct2D) |

## What stays in `windows/`, and why (follow-up plan)

| What | Why it is Windows-bound today | Way out |
|---|---|---|
| The window and everything painted in it (`main_window/`, `ui/`, `views/`, `user_controls/`, `dialogs/`, `styles/`, `actions/` dispatch) | Drawn with the Kubuno desktop framework (`kubuno-desktop-ui`, `kubuno-desktop-controls`, `kubuno-drive-desktop-app-controls`), which paints with Direct2D/DirectWrite into a Win32 window | A portable rendering backend in the framework (`kubuno/desktop`), then the views move to `common/` and each OS supplies a `UiHost`; until then `TextUi` is the portable interface |
| The tab model (`Tab`, `TabGroup`, `ColumnPane`) and the pixel metrics of the layouts | Built on the shell listing (`IShellItem` icons, the Recycle Bin, libraries) and the framework's theme constants | Move once listing goes entirely through `FileSystem` and the metrics through the framework's portable theme |
| Shell integration (`utils/shell*`, context menus, `ShellNew`, known folders, quick access, Recycle Bin, libraries, jump list, wallpaper, share sheet, network credentials, ISO mounting, security tab) | Explorer and Win32 shell APIs by nature | Stay Windows overrides; Linux/macOS get their own (`gio`/XDG, `NSWorkspace`) as `Shell` and new traits |
| The storage layer (`kubuno-drive-desktop-app-storage`, `utils/storage/`) | `IShellItem`, `IFileOperation` and the shell's progress dialogs | A portable `std::fs` implementation of the `core-storage` traits in `common/`, the shell one kept as the Windows override |
| Thumbnails, file properties, Git integration (`git2`, vendored libgit2) | Shell thumbnail cache and property system; libgit2 is a C library (cross builds need a C toolchain) | Thumbnails/properties behind traits; Git can move to `common/` when the CI builds the C part per OS |
| `settings::appearance_settings_service`, `general_settings_service` | A Direct2D colour type, a Win32 GUID | Portable colour and UUID types in `common/` |
| Bulk rename apply, file operations, folder watcher | Shell file operations, `ReadDirectoryChangesW` | `FileSystem` methods with portable defaults (`std::fs`, `notify`) |

## Build

The Kubuno desktop framework and the common crates of `kubuno/desktop` come from that repository at the tag named in
`Cargo.toml` (`[workspace.dependencies]`, one tag for all of them, pinned by `Cargo.lock`) and are linked
statically: `drive.exe` needs no DLL beside it. From this folder:

```powershell
# Windows (Rust stable, MSVC toolchain)
cargo build --release -p kubuno-drive-desktop
target\release\drive.exe [folder-to-open] [--sample]
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

```sh
# Any system: the portable app, its checks for the other targets, and the text interface
cargo test -p kubuno-drive-desktop-common -p kubuno-drive-desktop-localization -p kubuno-drive-desktop-core-storage
cargo check -p kubuno-drive-desktop-common --target x86_64-unknown-linux-gnu    # or aarch64-apple-darwin
cargo run -p kubuno-drive-desktop-linux -- --sample                             # or -macos
```

`--sample` opens a small fixed folder (`Kubuno Drive sample`), created under `KUBUNO_SANDBOX_DIR` when it names a
directory (a sandboxed run, settings included, never writes outside it), else under the temporary folder.

In Visual Studio, the crates are in the repository's solution, `Kubuno.Drive.slnx`, under **Desktop** (Common,
Windows, Linux, macOS).

The crates are licensed MIT, like the original project: see [`LICENSE-MIT`](LICENSE-MIT), which keeps the Files
Community's copyright notice (the rest of the drive repository is AGPL-3.0-or-later).

## History

The app was developed in `kubuno/desktop` (`windows/src/drive`) and moved here with its history in October 2026,
when every module repository started to hold all its clients; the same month it was split into the portable
`common/` app and the Windows overrides.
