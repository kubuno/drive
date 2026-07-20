<!--
  SPDX-FileCopyrightText: 2026 Kubuno contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Kubuno Drive

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
![Rust](https://img.shields.io/badge/Rust-edition_2021-orange.svg)
![React](https://img.shields.io/badge/React-19-61dafb.svg)
![Module](https://img.shields.io/badge/Kubuno-module-4D38DB.svg)

**Kubuno Drive — module de gestion de fichiers**

A module for [Kubuno](https://github.com/kubuno/core), the self-hosted, libre (AGPLv3) cloud platform.

## Features

- **Full-featured file explorer** — list and grid views, a dual-pane mode, drag & drop, Recent / Starred / Shared / Trash views, full-text search with saved searches (each saved search gets a real, shareable link).
- **Sharing, locks & activity** — share files and folders, lock files against concurrent edits, and follow what happened: a per-item activity log plus an account-wide **activity feed** (who did what to which item, newest first).
- **Cross-module labels** — Drive tags are backed by Kubuno's central label store: a tag put on a file here is the very same label other modules attach to their items and that the platform-wide labels page filters on.
- **Mobile experience** — a dedicated bottom navigation (Home / Starred / Shared / Files), a mobile Home screen with *Suggestions* and *Activity* tabs, a touch-friendly navigation drawer with a storage gauge, and responsive settings pages.
- **Desktop pop-outs** — the floating audio player and the built-in Paint editor can pop out into their own OS window in the Kubuno desktop client, via standalone `/drive/player` and `/drive/paint` routes.
- **File infrastructure for other modules** — open/save dialogs, folder pickers and the file browser ship in `@kubuno/drive` for every module to reuse; Drive also contributes a "Drive" tab to the core image picker, so any module can pick images straight from the user's files.
- **External & module storage** — WebDAV access, remote storage browsing, an admin System browser, and generic storage mounts published by other active modules rendered directly in the sidebar tree.
- **Storage insight** — a quota gauge in the header and a storage page whose single bar shows both how full the quota is and its per-category composition.

## Architecture

A standalone Rust process that registers with the [core](https://github.com/kubuno/core) at startup; the core proxies its routes (`/api/v1/drive/*`) and serves its runtime-loaded React frontend bundle.

- **Backend** — `src/`: Axum + SQLx (PostgreSQL, schema `drive`); migrations in `migrations/`.
- **Frontend** — `frontend/`: a React bundle built to `entry.js`, consuming `@kubuno/sdk`, `@kubuno/ui` and `@kubuno/drive` from npm (provided by the host at runtime via the import map).

## Install

This module ships in the **all-in-one [Kubuno](https://github.com/kubuno/core) Docker image** (`ghcr.io/kubuno/kubuno`) — the easiest way to self-host a full Kubuno instance (core + every module). See **[kubuno/docker](https://github.com/kubuno/docker)** for `docker compose` instructions.

Prebuilt native packages are attached to each [GitHub Release](https://github.com/kubuno/drive/releases): a Debian package (`.deb`), an RPM (Fedora / RHEL / openSUSE), a Windows installer (`.exe`) and a macOS package (`.pkg`). The Windows and macOS installers drop the module into an existing core installation and restart the service.

To build this module from source, see below.

## Build

**Requirements:** Rust ≥ 1.82, Node.js ≥ 24, PostgreSQL 16.

```bash
cargo build --release                     # → target/release/kubuno-drive
cd frontend && npm ci && npm run build     # → dist/{entry.js, entry.css}
bash build_deb.sh                          # → dist/kubuno-drive_*.deb
```

Native packages for other platforms (same self-detecting scripts on every module):

```bash
bash build_rpm.sh          # → dist/kubuno-drive-*.rpm       (Fedora / RHEL / openSUSE)
bash build_windows.sh      # → dist/kubuno-drive-setup-*.exe (NSIS; native or cargo-xwin cross-build)
bash build_macos.sh        # → dist/kubuno-drive-*.pkg       (run on macOS; UNIVERSAL=1 for a fat binary)
```

CI builds all of them on every `v*` tag — `build.yml` produces the `.deb`, `dist.yml` the RPM / Windows / macOS packages — and attaches them to the GitHub Release.

> Shared dependencies come from Kubuno — no `kubuno/core` checkout required:
> - **Rust** — shared crates via tagged git dependencies on `kubuno/core`.
> - **Frontend** — `@kubuno/sdk`, `@kubuno/ui`, `@kubuno/drive` from the `@kubuno` npm scope.

## License

[AGPL-3.0-or-later](LICENSE) © Kubuno contributors.
