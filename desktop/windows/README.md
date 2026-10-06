# Kubuno Drive for Windows

`drive.exe`: the app of [`../common`](../common/README.md) with the Windows platform registered. This folder holds
ONLY what Windows does differently:

| Crate | Role |
|---|---|
| `kubuno-drive-desktop` | The entry point (`drive.exe`, manifest and icon): registers the Windows platform and runs the app |
| `kubuno-drive-desktop-windows` | The Win32 window painted with Direct2D (framework of `kubuno/desktop`), the shell integration, and the Windows implementations of the extension points (`src/platform.rs`) |
| `kubuno-drive-desktop-app-storage` | Shell/storage layer (IShellItem, IFileOperation, watchers, FTP) |

## Credits

This code base is a Rust port of, and is heavily inspired by, **[Files](https://github.com/files-community/Files)**
(files-community, MIT license), the modern file manager for Windows. The application structure, views, controls,
vector icon geometries, localization strings and behaviours mirror the original C#/WinUI 3 implementation;
[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) maps each Rust module to its C# counterpart, and
[`../docs/PORTING.md`](../docs/PORTING.md) is the detailed porting journal. Huge thanks to the Files community for
their outstanding work. The crates are licensed MIT ([`../LICENSE-MIT`](../LICENSE-MIT)).

Build and run: see [`../README.md`](../README.md#build). What stays here and why: [`../README.md`](../README.md#what-stays-in-windows-and-why-follow-up-plan).
