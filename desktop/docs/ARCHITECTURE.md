# Architecture: mapping to `Files.App` (C#)

The module tree of the app mirrors `Files-main/src/Files.App/` so that a Rust module can be reviewed next to its C#
counterpart, file by file. Since October 2026 the tree is split in two crates that keep the same module paths:

- `common/kubuno-drive-desktop-common` holds what no operating system does differently (portable, checked on
  Windows, Linux and macOS);
- `windows/kubuno-drive-desktop-windows` holds the rest and re-exports each common module at its historical path
  (`crate::services::settings`, `crate::data::items::DirEntryItem`…), so the Windows code did not change its imports.

## Crates ↔ projects

| Rust | Folder | C# |
|---|---|---|
| `kubuno-drive-desktop-common` | `common/` | the portable part of `src/Files.App`, plus the platform extension points |
| `kubuno-drive-desktop-core-storage` | `common/` | `src/Files.Core.Storage` (OwlCore.Storage model) |
| `kubuno-drive-desktop-localization` | `common/` | `src/Files.App/Strings` + `AppLocalizationService` |
| `kubuno-drive-desktop-windows` | `windows/` | the Windows part of `src/Files.App` (window, shell, storage services) |
| `kubuno-drive-desktop-app-storage` | `windows/` | `src/Files.App.Storage` (IShellItem, IFileOperation, watchers, FTP) |
| `kubuno-drive-desktop` | `windows/` | `App.xaml.cs` start-up: the `drive.exe` entry point |
| `kubuno-drive-desktop-linux`, `-macos` | `linux/`, `macos/` | (no counterpart: the portable app with the default platform) |
| `kubuno-drive-desktop-shared`, `-app-controls` | `kubuno/desktop` | `src/Files.Shared`, `src/Files.App.Controls` |

## Platform extension points (`common/…/src/platform.rs`)

| Trait | Portable default | Windows (`windows/…/src/platform.rs`) |
|---|---|---|
| `FileSystem` (folder listing, hidden items) | `std::fs`, dot files hidden | hidden and system attributes |
| `Shell` (open, verbs) | unsupported | `ShellExecuteW`, context-menu verbs |
| `Culture` (UI language) | `LC_ALL` / `LC_MESSAGES` / `LANG` | `GetUserDefaultLocaleName` |
| `Locale` (dates, times, month and language names) | fixed formats, English month names | `GetDateFormatEx`, `GetTimeFormatEx`, `GetLocaleInfoEx` |
| `UiHost` (the user interface) | `app::TextUi`, the start folder as text | `WindowsUi`: the Win32 window painted with Direct2D |

An entry point builds its `Platform` and its `UiHost` and calls `app::run`, which registers the platform, sets the
language and parses the command line (`app::Launch`: folders, `--sample`, `--pos x y`).

## Modules ↔ folders

| Rust (`src/…`) | Crate | C# (`Files.App/…`) | Content |
|---|---|---|---|
| `app.rs`, `platform.rs`, `sample.rs` | common | `App.xaml.cs` (part) | Start-up, extension points, the `--sample` folder |
| `lib.rs` | windows | `App.xaml.cs` | Splash screen, diagnostics, DPI, COM, message loop (`WindowsUi`) |
| `main_window/` | windows | `MainWindow.xaml.cs` + `Views/MainPage.xaml.cs` | The window: wndproc, clicks, keyboard, commands, pane placement, flyout capture |
| `data/items/listed_item.rs` | common | `Data/Items/ListedItem.cs` | `DirEntryItem`, the folder listing through the platform's `FileSystem` |
| `data/items/*` (others) | windows | `Data/Items/` | Drives, quick access, recent files, `HomeModel`, ShellNew entries |
| `services/settings/` | common | `Services/Settings/` | Every persisted setting (one field per C# property) and its store |
| `services/settings/appearance…`, `general…` | windows | `Services/Settings/` | Direct2D colours, the Win32 GUID of the user id |
| `services/date_time_formatter/` | common | `Services/DateTimeFormatter/` | « Il y a 4 jours », locale formats through the platform's `Locale` |
| `helpers/layout/` | common | `Helpers/Layout/LayoutPreferencesManager.cs` | Display preferences PER FOLDER |
| `view_models/shell_view_model.rs` | common | `ViewModels/ShellViewModel.cs` | `Location`, `FolderLayoutModes` (`ViewMode`), sort (`OrderFiles`), `GroupOption` |
| `view_models/shell_view_model.rs` | windows | `ViewModels/ShellViewModel.cs` | `Tab`: listing, filter, history, Columns blades; `LayoutSizeKindHelper` pixel metrics |
| `utils/storage_history/` | common | `Utils/StorageHistory/` | Undo/redo of file operations |
| `utils/storage/` | windows | `Utils/Storage/` | File operations: copy, shortcuts, archives, SendTo |
| `utils/folder_watcher.rs` | windows | `ShellViewModel.WatchForDirectoryChanges` | Folder watching |
| `utils/shell/` | windows | `Utils/Shell/ContextMenu.cs` | `IContextMenu` (« Show more options ») + STA worker |
| `utils/thumbnails/` | windows | `Utils/Storage/Helpers/FileThumbnailHelper.cs` | Shell icon/thumbnail cache |
| `user_controls/` | windows | `UserControls/` | See each module's doc, control by control |
| `views/layouts/` | windows | `Views/Layouts/` | Details, List/Cards/Grid, Columns (`BladeView`) |
| `views/settings/*_page.rs` | windows | `Views/Settings/*Page.xaml` | One page per file, same split |
| `styles/` | windows | `Styles/`, Fluent tokens, `ThemedIcon` | Light/dark colours, vector icon geometries |

## No C# counterpart

| Rust | Role |
|---|---|
| `ui/` (windows) | The « XAML runtime »: `Layout` (geometry of the whole page, hit-testing) + `Painter` (Direct2D primitives). In C#, XAML does this work itself |
| `graphics` (windows) | DirectComposition swap chain, Mica, DirectWrite formats, PNG (`kubuno-drive-desktop-app-controls`) |

## Still Windows-bound, and why

See [`../README.md`](../README.md), "What stays in windows/".

## `actions/` ↔ `Actions/`

The `Action` trait (`actions/mod.rs`, windows) carries `IAction` — `Label`, `Description`, `Glyph`, `HotKey`,
`IsExecutable`, `ExecuteAsync` — and `ToggleAction` carries `IToggleAction.IsOn`. `actions::commands()` plays the
`CommandManager`: the palette reads the descriptions there, the keyboard resolves shortcuts (`by_hotkey`), the menus
the labels. One Rust file per C# file. The porting journal (`PORTING.md`, French) lists what is ported; `Actions/Git/`
is excluded (user decision, July 2026).
