# Changelog

All notable changes to **kubuno-drive** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/). Entries are added under
`[Unreleased]` **as the change is made**; `_tools/release.sh` stamps them under the version
number at release time, and CI publishes that section as the GitHub Release notes.

## [Unreleased]

### Added

- **"Home" landing screen.** A new **Accueil** entry tops the sidebar (above
  "My Drive") and opens a welcome page in the spirit of the major cloud drives:
  a centered "Welcome to Drive" banner, a wide search box, quick filter chips
  (Type / Owner / Modified date / Location), a **Suggested folders** row (the
  folders you recently worked in) and a **Suggested files** grid (recently
  opened items, with a list/grid toggle and a "See more" link). Typing a query
  jumps straight to the results; a chip narrows the whole drive; a card opens
  the file in its app or preview, or the folder in the explorer. On phones it
  keeps the existing tabbed home.
- **Remote mounts can be edited.** A pencil on each mount opens its settings:
  everything but the secrets comes back filled in, and a password left blank
  keeps the stored one — correcting a host no longer means retyping credentials.
- **"List the server's shares"** in the SMB form. It asks the server and shows
  each share's real name beside its description, which is the distinction that
  makes a mount work: a share called `home_martinien` may be described as
  "Home Martinien", and entering the description fails with "share not found".
- **Platform fonts shipped with the module**: 20 open-licensed font files (Google Sans
  Text, Google Sans, Roboto, Google Sans Flex, Roboto Flex, Inter, DM Mono — variable
  where a variable release exists) are embedded in the binary and seeded into
  `System/Fonts` at startup, marked protected: they cannot be deleted, administrators
  included. The seed is idempotent and refreshes a seeded file **in place** when the
  embedded binary changed (protected files cannot be replaced through the API, so
  corrections can only arrive this way).
- **Google-Fonts-style public endpoints**: `GET /fonts/css2?family=…&display=swap`
  generates `@font-face` rules from the actual binaries in `System/Fonts` (family,
  weight and stretch ranges read from their `name`/`fvar`/`OS-2` tables, cached), and
  `GET /fonts/files/:id` serves the bytes with ETag/304 and day-long caching. Both are
  unauthenticated on purpose — stylesheet fetches carry no credentials and the surface
  only exposes the shared fonts directory. Any font an administrator drops into
  `System/Fonts` becomes servable the same way.
- Fonts explorer: protected fonts show a **"Police système" chip** and never offer
  deletion; the embed page now leads with a `<link>`/`@import` to the instance's own
  css2 endpoint, the raw `@font-face` rules remaining as an alternative.
- A **mini-panel for the shell's right rail**: recent and starred files, to reach a
  document without leaving what you are writing.

### Changed

- **New Drive logo.**
- **Remote storage panel**: a floating window instead of a full-height drawer,
  so the files being worked on stay visible behind it. It also opens from every
  Drive screen now — from a remote mount it used to set nothing on screen until
  you navigated back to My Drive.
- **Provider icons** are the official brand marks (Nextcloud, ownCloud, Google
  Drive, Dropbox, Windows) in their own colours, instead of emoji that showed
  the same cloud for Nextcloud and ownCloud. Protocols without a brand (WebDAV,
  SFTP, FTP, NFS) keep a neutral glyph.
- **Search view**: twice as much space between tiles in the icon views, matching
  the main explorer.
- Selection tick badges no longer sit on file and folder cards.
- The fonts search bar follows the new default background (`#e9eef6`).
- The dual-pane explorer's splitter is a 5px hairline with a grip pill on hover, like
  every other resize handle.
- Default application background token aligned with the core (`--body-bg` `#f8fafd`). Only
  visible when the module runs standalone: inside the shell the active theme sets it.
- Search bar background now comes from the `--color-search-bg` token (unified at `#e9eef6`)
  rather than a hard-coded colour.
- New `--color-viewer-backdrop` token for the full-screen preview backdrop.

### Fixed

- **A broken mount advertised itself as "Connected".** Its real state and the
  reason are now shown on the mount, and browsing it explains what to do rather
  than failing silently.


- The Google-Fonts-style toolbar of the Fonts view (search, sort, selection bag) had
  become unreachable behind the header's magnifying-glass search mode; it is pinned
  inline again.

[Unreleased]: https://github.com/kubuno/drive/compare/v0.1.5...HEAD
