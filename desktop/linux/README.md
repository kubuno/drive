# Kubuno Drive for Linux

`kubuno-drive-desktop-linux` (binary `kubuno-drive-desktop`): the app of [`../common`](../common/README.md) with the
portable platform, and its text interface (`app::TextUi`) until the Kubuno desktop framework renders on Linux. Linux
overrides nothing yet: its native window and services will join this folder as implementations of the extension
points of `kubuno_drive_desktop_common::platform` (see [`../README.md`](../README.md#platform-extension-points)).

```sh
cargo run -p kubuno-drive-desktop-linux -- --sample      # from desktop/
```
