# Changelog

All notable changes to **kubuno-drive** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/). Entries are added under
`[Unreleased]` **as the change is made**; `_tools/release.sh` stamps them under the version
number at release time, and CI publishes that section as the GitHub Release notes.

## [Unreleased]

## [0.1.11] - 2026-09-18

### Security

- **HTTP/2 layer updated to a patched release.** `h2` moves from 0.4.15 to
  0.4.19, closing a denial of service through unbounded empty DATA frames
  (RUSTSEC-2026-0258).
- **Error library updated to a patched release.** `anyhow` moves from 1.0.102
  to 1.0.104, closing an unsoundness in `Error::downcast_mut()`
  (RUSTSEC-2026-0190).
- **TLS library updated to a patched release.** The pinned `rustls` carried
  RUSTSEC-2026-0285 (medium). Every outbound HTTPS connection goes through it.

## [0.1.10] - 2026-09-18

### Changed

- **This module now installs as a Kubuno package (`.kbpkg`) only.** Its system
  packages (Debian/RPM and the Windows and macOS installers) are no longer
  built: the module is distributed as one `.kbpkg` per platform (Linux, Windows,
  macOS) that the Kubuno server installs itself — from the admin console, or
  offline with `kubuno modules:install <file>.kbpkg`.
- **The storage client now reaches the files service through the core, not
  directly.** Editor modules (documents, notes, and the like) talk to file
  storage through this crate's `FilesClient`. It used to call the files module
  on its own port; on a deployment where each module holds only its own derived
  secret, that direct call is rejected and file operations fail. The client now
  sends every request to the core, which authenticates the caller and forwards
  it to the files service on their behalf. Callers pass the core's URL when they
  build the client instead of the files service's URL; nothing else about how
  they use it changes. This also works unchanged on single-secret deployments.


- **Dates are formatted by the platform now, not by a library.** `date-fns` is
  gone from this module: the shared SDK exposes helpers built on `Intl`, which is
  localised for every language we ship and needs no locale bundle loaded. Call
  sites say what a date is FOR — `formatDate(d, 'date')` — and the platform
  decides how to write it, so a reader in Japanese no longer gets a French
  layout. Machine formats (keys, `<input type="date">` values) go through
  `toISODate` and friends, built from local calendar fields so the day cannot
  shift near midnight.
- **Class names are composed by `cn()` from `@ui`**, replacing `clsx`. One less
  dependency for a dozen lines of finished logic; call sites are unchanged.
- **The RPM package now names the same maintainer as the Debian one.** Its
  changelog entry used a placeholder address on a domain the project does not
  use; it now matches the maintainer of the `.deb`, on the project's own domain.
  Nothing about what the package installs changes.

- **The package maintainer address moved to the project's own domain.** The
  Debian package's `Maintainer` field now uses an address on the project's own
  domain. Nothing about what the package installs changes.

- **Security reports now go to an address on the project's own domain.** The
  address published in `SECURITY.md` moved to that domain; the previous one is
  retired. Reporting through GitHub Security Advisories is unaffected.

- **The README now opens with the module's logo.** The public README on
  GitHub now shows the module's designer logo (the same PNG shown as the
  browser tab icon and in the applications menu) at the top of the page — the
  repository landing now matches the icon a signed-in user sees inside the
  platform. The image ships in-repo, under `.github/logo.png`, so it renders
  even when the repo is browsed offline.

- **New Drive logo** — a blue isometric stack of platters with a white top
  face and gold tabs, used as the browser-tab icon and in the applications
  menu. It is now raster (PNG) designer artwork.

- **Classic window-caption glyphs on the floating audio player.** Expand is a
  plain square and reduce two overlapping squares, instead of diagonal double
  arrows.

- **The advanced-search panel and the search bar now stay in sync both ways.**
  Opening the panel pre-fills the "Contains the words" field with the bar's
  current text, and editing that field rewrites the bar's text live (running
  the search as you type, exactly like typing in the bar). Drive's search is
  plain free text — the other panel fields (type, owner, location, dates…) are
  structured filters with no text representation, so they intentionally stay
  panel-only. "Reset" now also clears the search bar's text.

### Fixed

- **Folders whose stored path drifted from their name are repaired on start.**
  A folder's path is stored, not recomputed on read, and the rename that keeps
  it current refuses protected folders — so a protected folder renamed by a raw
  database write (as happened to an application's own protected folder during an
  earlier rename) kept a path from its old name. Two folders could then claim the
  same local path, and desktop sync clients would materialise neither, leaving
  files that were present on the server missing on the machine. The drive now
  reconciles these paths at startup: it recomputes each folder's path from its
  parent and its name and relocates the folder's files one by one, never as a
  whole directory, so a file that a neighbouring folder happens to share on disk
  is left untouched; where two records point at the very same stored file the
  content is copied rather than moved, so neither record breaks. When a folder is
  moved off a path it had been sharing, the neighbour that legitimately keeps that
  path is re-published as well, so a client that had collapsed the two onto one
  local location restores the neighbour's files instead of losing them. The pass
  is a no-op on healthy instances and its corrections flow to clients on their
  next sync, so the missing files reappear without any manual step.

## [0.1.9] - 2026-08-26


### Fixed


- **The interface builds against the published type surface again.** Drive reads
  `is_protected` on the files the platform ships, a field the published
  `@kubuno/drive` did not declare — so a clean install failed to typecheck while a
  developer's machine, holding an older copy, did not. The package now declares
  it, and the lockfile takes that version.
- **A withdrawn dependency is no longer used.** A crate deep in the tree
  (`spin` 0.9.8, pulled in through the HTTP stack) was yanked by its authors.
  No vulnerability was announced, but a withdrawn crate has no business in a
  release; the lockfile now takes the version that replaced it.
## [0.1.8] - 2026-08-26



### Fixed

- **The quality gate rejected the font-name reader.** A lint introduced with a
  newer Rust compiler refused reading UTF-16 name records two bytes at a time
  through `chunks_exact`; the pair is now read as a fixed-size array, which says
  the same thing without indexing.
### Fixed

- **The package could not be built where `zip` is absent.** The Windows job of
  the continuous integration has no `zip`, so the Windows package was simply lost
  the first time it was attempted — a script failure, not a build failure. The
  builder now falls back to 7-Zip, then to PowerShell.
## [0.1.7] - 2026-08-26



### Added

- **Drive now also ships a `.kbpkg`** — the single package format a Kubuno
  server installs by itself, identical on every system. It carries the same
  binary, interface and manifest as the `.deb`, arranged the way the server
  expects to find a module on disk, plus a `SHA256SUMS` so an offline copy can
  be checked without the catalogue. Nothing changes for existing installations:
  the system packages are still published, and a catalogue that sees both simply
  prefers the new one. Drive is the pilot for this format; the other modules
  follow once it has proven itself.
### Fixed

- **A built package could be thrown away instead of published.** The job that
  attaches a package to the release waited ten minutes for another workflow to
  create that release, then gave up with "release never appeared — build.yml
  likely failed". The diagnosis was wrong: on a repository whose `.deb` takes
  longer than ten minutes to build, the release simply did not exist yet, and a
  package that had built perfectly was discarded. Four modules reached v0.1.6
  with packages missing for some systems because of it. The job now creates the
  release itself when it is missing, so it no longer depends on another workflow
  finishing first.
### Added

- **Security policy and CI quality gate.** A `SECURITY.md` documents how to
  report vulnerabilities, and a CI workflow enforces `clippy -D warnings`, a
  dependency-vulnerability audit (`cargo audit`) and the frontend typecheck/tests.

### Security

- **Drive now authenticates proxied requests from a signed token instead of
  trusting plain headers.** User routes require a valid `X-Kubuno-Auth` token
  minted by the core with this module's internal secret (see `kubuno-modauth`),
  rather than reading `X-Kubuno-User-*` headers at face value — which any process
  reaching Drive's loopback port could otherwise forge to act as any user.

### Changed

- **Pill-shaped buttons are gone from the interface.** Filter chips, view
  segments, tab selectors and action buttons that were drawn as pills now use the
  same 4 px corner radius as every other button — the shape set them apart for no
  reason other than habit. Round buttons that hold a lone icon, avatars, status
  dots and non-clickable badges keep their shape: a circle around a single glyph
  is not a pill.

- **Plus Jakarta Sans is shipped with the module** (roman and italic, SIL Open
  Font License), seeded into `System/Fonts` like the other platform faces and
  served by the css2 endpoint, so documents can use it. Outfit stays available.

- **Outfit replaces the Google Sans families in the shipped font library.** The
  module embedded nine Google font files (~26 MB of the 30 MB it carried) and
  seeded them into `System/Fonts`. They are gone: the embedded set is now Outfit
  (SIL Open Font License, one variable file) plus the openly licensed families
  already there — Roboto, Roboto Flex, Inter, DM Mono. The module's font assets
  drop from 30 MB to 4.9 MB.
- **Fonts the module no longer ships are actively removed at startup.** Seeding
  never deleted anything, and what it installed is `is_protected`, which the API
  refuses to remove — so a retired face would have kept being served for ever.
  The seed now un-protects and deletes the faces it has dropped, then installs
  the current set.

- **Opening Drive now lands on "Accueil"** instead of My Drive. The app's launch
  target is its Home hub (`/drive/home`); My Drive stays at `/drive`, reachable
  from the sidebar and by every existing folder link.
- **Home screen reworked to stop echoing "Recent".** Its file section no longer
  replays the opened-file journal; it now surfaces a curated blend — files you
  recently **modified**, starred files, and files recently shared with you —
  distinct from Recent. Folders and files render through the shared explorer, so
  their cards, view modes, sort bar and context menu are identical to every other
  Drive view, and the page now uses the full width. The in-page search box was
  removed (the header search already covers it); the quick filter chips stay.

## [0.1.6] - 2026-08-19

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
  makes a mount work: a share called `backups` may be described as
  "Nightly Backups", and entering the description fails with "share not found".
- **Platform fonts shipped with the module**: 20 open-licensed font files (Google Sans
  Text, Google Sans, Roboto, Google Sans Flex, Roboto Flex, Inter, DM Mono — variable
  where a variable release exists) are embedded in the binary and seeded into
  `System/Fonts` at startup, marked protected: they cannot be deleted, administrators
  included. The seed is idempotent and refreshes a seeded file **in place** when the
  embedded binary changed (protected files cannot be replaced through the API, so
  corrections can only arrive this way).
- **Self-hosted font endpoints**: `GET /fonts/css2?family=…&display=swap`
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


- The Fonts view's toolbar (search, sort, selection bag) had
  become unreachable behind the header's magnifying-glass search mode; it is pinned
  inline again.

[Unreleased]: https://github.com/kubuno/drive/compare/v0.1.11...HEAD
[0.1.11]: https://github.com/kubuno/drive/releases/tag/v0.1.11
[0.1.10]: https://github.com/kubuno/drive/releases/tag/v0.1.10
[0.1.9]: https://github.com/kubuno/drive/releases/tag/v0.1.9
[0.1.8]: https://github.com/kubuno/drive/releases/tag/v0.1.8
[0.1.7]: https://github.com/kubuno/drive/releases/tag/v0.1.7
[0.1.6]: https://github.com/kubuno/drive/releases/tag/v0.1.6
