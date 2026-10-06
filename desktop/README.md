# Kubuno Drive — desktop apps

The native desktop clients of the drive module, one folder per operating system:

| Folder | App | Status |
|---|---|---|
| [`windows/`](windows/README.md) | Kubuno Drive for Windows (`drive.exe`, crate `kubuno-drive-desktop` and its engine crates; a Rust port of Files, MIT) | alpha |
| [`linux/`](linux/README.md) | Kubuno Drive for Linux | not written yet |
| [`macos/`](macos/README.md) | Kubuno Drive for macOS | not written yet |

Each folder is a Cargo workspace of its own, independent of the server's (the repository root). The apps are built
on the Kubuno desktop framework of [`kubuno/desktop`](https://github.com/kubuno/desktop), taken by git tag
(`desktop-v<version>`) and linked statically: an app builds from this repository alone.
The Windows file manager works on the local file system (and the Windows shell namespace) and needs no account
today; the apps that reach a Kubuno server borrow their access tokens from **Kubuno Desktop** (the shell, from
`kubuno/desktop`), a service dependency, never a binary one.

The desktop app moved here from `kubuno/desktop` (`windows/src/drive`) with its history in October 2026, when every
module repository started to hold all its clients (server, web frontend, desktop, and later mobile).
