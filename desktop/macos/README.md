# Kubuno Drive for macOS

`kubuno-drive-desktop-macos` (binary `kubuno-drive-desktop`): the app of [`../common`](../common/README.md) with the
portable platform, and its text interface (`app::TextUi`) until the Kubuno desktop framework renders on macOS. macOS
overrides nothing yet: its native window and services will join this folder as implementations of the extension
points of `kubuno_drive_desktop_common::platform` (see [`../README.md`](../README.md#platform-extension-points)).

```sh
cargo run -p kubuno-drive-desktop-macos -- --sample      # from desktop/
```
