<!--
  SPDX-FileCopyrightText: 2026 Kubuno contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->

<div align="center">

<img src=".github/logo.png" alt="Kubuno Drive logo" width="120">

# Kubuno — Drive

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
![Rust](https://img.shields.io/badge/Rust-edition_2021-orange.svg)
![React](https://img.shields.io/badge/React-19-61dafb.svg)
![Module](https://img.shields.io/badge/Kubuno-module-4D38DB.svg)
![Status](https://img.shields.io/badge/status-alpha-yellow.svg)

**File storage, sharing and remote mounts for [Kubuno](https://github.com/kubuno/core) — the self-hosted, libre (AGPLv3) cloud platform, a sovereign alternative to Google Workspace and Microsoft 365.**

Drive is where every other Kubuno app keeps its files. It gives users a full file
manager and gives modules the open/save dialogs, folder pickers and file browser
they build on.

</div>

---

## ✨ Features

- 📁 **Full-featured file explorer** — list and grid views, a dual-pane mode, drag & drop, and Home / Recent / Starred / Shared / Trash views. Opening Drive lands on a curated **Home** hub that blends files you recently modified, starred and were shared, rendered through the same explorer as every other view.
- 🔎 **Search that lives in the URL** — free-text search with saved searches, each getting a real, shareable link. The advanced-search panel and the header search bar stay in sync both ways, so the fields and the query text can never disagree.
- 🤝 **Sharing, locks & activity** — share files and folders, lock files against concurrent edits, and follow what happened through a per-item activity log plus an account-wide **activity feed** (who did what to which item, newest first).
- 🏷️ **Cross-module labels** — a tag put on a file here is the very same label other modules attach to their items and that the platform-wide labels page filters on.
- 🔌 **File infrastructure for other modules** — open/save dialogs, folder pickers and the file browser ship in `@kubuno/drive` for every module to reuse; Drive also contributes a "Drive" tab to the core image picker, so any module can pick images straight from the user's files.
- 🌐 **External & module storage** — WebDAV access, remote storage browsing (with editable mounts and SMB share discovery), an admin System browser, and generic storage mounts published by other active modules rendered directly in the sidebar tree.
- 🔤 **Self-hosted fonts** — the module ships an openly-licensed font library into `System/Fonts` and serves it through its own `css2`/font endpoints, so documents never fetch fonts from a third-party CDN.
- 🖥️ **Desktop pop-outs** — the floating audio player and the built-in Paint editor can pop out into their own OS window in the Kubuno desktop client, via standalone `/drive/player` and `/drive/paint` routes.
- 📱 **Mobile experience** — a dedicated bottom navigation, a mobile Home screen with *Suggestions* and *Activity* tabs, a touch-friendly navigation drawer with a storage gauge, and responsive settings pages.
- 📊 **Storage insight** — a quota gauge in the header and a storage page whose single bar shows both how full the quota is and its per-category composition.

## 🏗️ Architecture

Drive is a **Kubuno module**: a standalone Rust process (port `3101`) that registers with the [core](https://github.com/kubuno/core) at startup. The core proxies its routes (`/api/v1/drive/*`) and serves its runtime-loaded frontend bundle.

```
core (kubuno/core)  ──proxy──►  kubuno-drive (this repo, :3101)
       │                              ├─ Rust backend (Axum + PostgreSQL, schema `drive`)
       └─ serves /modules/drive/entry.js (React frontend, loaded at runtime)
```

- **Backend** — `src/`: Axum + SQLx (PostgreSQL, schema `drive`); migrations in `migrations/`.
- **Frontend** — `frontend/`: a React bundle built to `entry.js`, consuming `@kubuno/sdk`, `@kubuno/ui` and `@kubuno/drive` from npm (provided by the host at runtime via the import map).

## 📥 Install

Modules install as a **Kubuno package (`.kbpkg`)** — a single, self-contained archive the Kubuno server unpacks itself (in pure Rust, identically on Linux, Windows and macOS). There are no native system packages for a module; only the core ships those.

The easiest way to self-host a full Kubuno instance (core + every module) is the **all-in-one [Docker image](https://github.com/kubuno/docker)** (`ghcr.io/kubuno/kubuno`), which already bundles Drive.

To build and install this module on its own:

```bash
bash build_kbpkg.sh --install        # build → install into the store → restart the core
```

Or install a prebuilt `.kbpkg` (offline, no catalogue required):

```bash
sudo kubuno modules:install dist/drive-<version>-<os>-<arch>.kbpkg
sudo systemctl restart kubuno        # the core loads the module on (re)start
```

A `.kbpkg` is attached to every tagged [GitHub Release](https://github.com/kubuno/drive/releases) (Linux via `build.yml`, Windows/macOS via `dist.yml`).

## 🛠️ Build & development

**Requirements:** Rust ≥ 1.82, Node.js ≥ 24, PostgreSQL 16.

```bash
cargo build --release                      # → target/release/kubuno-drive
cd frontend && npm ci && npm run build      # → dist/{entry.js, entry.css}
bash build_kbpkg.sh                         # → dist/drive-<version>-<os>-<arch>.kbpkg
```

> Shared dependencies come from Kubuno — no `kubuno/core` checkout required:
> - **Rust** — shared crates via tagged git dependencies on `kubuno/core`.
> - **Frontend** — `@kubuno/sdk`, `@kubuno/ui`, `@kubuno/drive` from the `@kubuno` npm scope. They are `external` at runtime (the host provides the singletons via its import map); the npm packages supply the build-time type surface.

## 📦 Tech stack

Rust 2021 · Axum 0.7 · Tokio · SQLx 0.8 (PostgreSQL, schema `drive`) — React 19 · TypeScript · Vite · Tailwind CSS v4 · Zustand · React Query.

## 🤝 Contributing

Issues and pull requests are welcome. For any significant change, please open an issue first.

## 📄 License

[AGPL-3.0-or-later](LICENSE) © Kubuno contributors.
