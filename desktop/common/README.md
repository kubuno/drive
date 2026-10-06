# Kubuno Drive desktop — the portable app

The COMPLETE desktop app, for every operating system; the OS folders (`../windows`, `../linux`, `../macos`) only
override its platform extension points and start it.

| Crate | Role |
|---|---|
| `kubuno-drive-desktop-common` | Listed item and folder listing, settings and their store, layouts, sort and grouping, date formatting, storage history, start-up (`app::run`, `app::Launch`, `--sample`), the text interface (`app::TextUi`) and the extension points (`platform`: `FileSystem`, `Shell`, `Culture`, `Locale`, `UiHost`) |
| `kubuno-drive-desktop-core-storage` | Storage model traits (port of `Files.Core.Storage`) |
| `kubuno-drive-desktop-localization` | 49 cultures from the original `.resw` resources, culture fallback |

No `windows` crate, no UI framework and no C library here: `cargo check` passes for Windows, Linux and macOS
targets (the CI checks the three). `vendor/` keeps the `suppaftp` sources for reference; it is not built.
