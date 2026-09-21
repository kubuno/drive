-- SQLite — `drive` is an ATTACHed database file, attached on every pooled
-- connection by kubuno-db, so the qualified names below resolve as they do on
-- the other two engines. This single file declares the FINAL shape the
-- PostgreSQL side reached across its 000001..000029 migrations.
--
-- Differences from PostgreSQL, and why:
--   * UUID -> BLOB, TIMESTAMPTZ -> TEXT (`%F %T%.f`, UTC), JSONB/REAL[] -> TEXT
--     holding JSON, BYTEA -> BLOB, DOUBLE PRECISION -> REAL, as sqlx encodes them.
--   * No DEFAULT on `id`: SQLite has no UUID generator; the process supplies it.
--     activity_log.id stays an AUTOINCREMENT integer.
--   * Full-text search is the normalized-column form (name_norm / content_norm,
--     filled in Rust): no tsvector, no unaccent, no pg_trgm.
--   * The delta layer is the journal (change_counter + per-row change_seq) plus
--     the tombstones table; no sequence, no triggers. updated_at is maintained
--     in Rust where it matters.
--   * Foreign-key REFERENCES are unqualified (SQLite assumes the same database);
--     kubuno-db enables `PRAGMA foreign_keys`, so CASCADE deletes fire.

CREATE TABLE drive.folders (
    id          BLOB    NOT NULL PRIMARY KEY,
    owner_id    BLOB    NOT NULL,
    parent_id   BLOB    REFERENCES folders(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    path        TEXT    NOT NULL,
    is_starred  BOOLEAN NOT NULL DEFAULT FALSE,
    versioning_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    color       TEXT,
    is_protected BOOLEAN NOT NULL DEFAULT FALSE,
    is_trashed  BOOLEAN NOT NULL DEFAULT FALSE,
    trashed_at  TEXT,
    icon        TEXT,
    is_hidden   BOOLEAN NOT NULL DEFAULT FALSE,
    change_seq  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    CONSTRAINT folders_name_unique_per_parent UNIQUE (owner_id, parent_id, name)
);
CREATE INDEX drive.idx_files_folders_owner   ON folders(owner_id);
CREATE INDEX drive.idx_files_folders_parent  ON folders(parent_id);
CREATE INDEX drive.idx_files_folders_path    ON folders(owner_id, path);
CREATE INDEX drive.idx_files_folders_trashed ON folders(owner_id, is_trashed);
CREATE INDEX drive.idx_drive_folders_seq     ON folders(owner_id, change_seq);

CREATE TABLE drive.files (
    id              BLOB    NOT NULL PRIMARY KEY,
    owner_id        BLOB    NOT NULL,
    folder_id       BLOB    REFERENCES folders(id) ON DELETE SET NULL,
    name            TEXT    NOT NULL,
    extension       TEXT,
    mime_type       TEXT    NOT NULL DEFAULT 'application/octet-stream',
    size_bytes      INTEGER NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
    storage_path    TEXT    NOT NULL,
    content_hash    TEXT,
    metadata        TEXT    NOT NULL,
    is_starred      BOOLEAN NOT NULL DEFAULT FALSE,
    is_trashed      BOOLEAN NOT NULL DEFAULT FALSE,
    trashed_at      TEXT,
    has_thumbnail   BOOLEAN NOT NULL DEFAULT FALSE,
    versioning_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    is_protected    BOOLEAN NOT NULL DEFAULT FALSE,
    change_seq      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
);
CREATE INDEX drive.idx_files_files_owner    ON files(owner_id);
CREATE INDEX drive.idx_files_files_folder   ON files(folder_id);
CREATE INDEX drive.idx_files_files_trashed  ON files(owner_id, is_trashed);
CREATE INDEX drive.idx_files_files_starred  ON files(owner_id, is_starred);
CREATE INDEX drive.idx_files_files_mime     ON files(owner_id, mime_type);
CREATE INDEX drive.idx_files_files_hash     ON files(content_hash);
CREATE INDEX drive.idx_drive_files_seq      ON files(owner_id, change_seq);
CREATE INDEX drive.idx_drive_files_protected ON files(owner_id, is_protected);

CREATE TABLE drive.shares (
    id              BLOB    NOT NULL PRIMARY KEY,
    owner_id        BLOB    NOT NULL,
    file_id         BLOB    REFERENCES files(id)   ON DELETE CASCADE,
    folder_id       BLOB    REFERENCES folders(id) ON DELETE CASCADE,
    token           TEXT    UNIQUE,
    recipient_id    BLOB,
    can_download    BOOLEAN NOT NULL DEFAULT TRUE,
    can_upload      BOOLEAN NOT NULL DEFAULT FALSE,
    can_delete      BOOLEAN NOT NULL DEFAULT FALSE,
    password_hash   TEXT,
    expires_at      TEXT,
    download_count  INTEGER NOT NULL DEFAULT 0,
    max_downloads   INTEGER,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    revoked_at      TEXT,
    CONSTRAINT shares_target CHECK (
        (file_id IS NOT NULL AND folder_id IS NULL) OR
        (file_id IS NULL AND folder_id IS NOT NULL)
    )
);
CREATE INDEX drive.idx_files_shares_owner     ON shares(owner_id);
CREATE INDEX drive.idx_files_shares_file      ON shares(file_id);
CREATE INDEX drive.idx_files_shares_folder    ON shares(folder_id);
CREATE INDEX drive.idx_files_shares_recipient ON shares(recipient_id);

CREATE TABLE drive.upload_sessions (
    id              BLOB    NOT NULL PRIMARY KEY,
    owner_id        BLOB    NOT NULL,
    folder_id       BLOB    REFERENCES folders(id) ON DELETE SET NULL,
    filename        TEXT    NOT NULL,
    mime_type       TEXT    NOT NULL DEFAULT 'application/octet-stream',
    total_size      INTEGER NOT NULL,
    chunk_size      INTEGER NOT NULL,
    total_chunks    INTEGER NOT NULL,
    chunks_received INTEGER NOT NULL DEFAULT 0,
    status          TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'uploading', 'assembling', 'done', 'failed')),
    error           TEXT,
    file_id         BLOB    REFERENCES files(id) ON DELETE SET NULL,
    temp_path       TEXT    NOT NULL,
    overwrite       BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at      TEXT    NOT NULL,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX drive.idx_files_uploads_owner   ON upload_sessions(owner_id);
CREATE INDEX drive.idx_files_uploads_status  ON upload_sessions(status);
CREATE INDEX drive.idx_files_uploads_expires ON upload_sessions(expires_at);

CREATE TABLE drive.file_versions (
    id              BLOB    NOT NULL PRIMARY KEY,
    file_id         BLOB    NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    owner_id        BLOB    NOT NULL,
    version_number  INTEGER NOT NULL,
    storage_path    TEXT    NOT NULL,
    size_bytes      INTEGER NOT NULL DEFAULT 0,
    content_hash    TEXT,
    comment         TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    CONSTRAINT file_versions_unique UNIQUE (file_id, version_number)
);
CREATE INDEX drive.idx_files_versions_file  ON file_versions(file_id);
CREATE INDEX drive.idx_files_versions_owner ON file_versions(owner_id);

CREATE TABLE drive.activity_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id      BLOB    REFERENCES files(id)   ON DELETE CASCADE,
    folder_id    BLOB    REFERENCES folders(id) ON DELETE CASCADE,
    user_id      BLOB    NOT NULL,
    user_display TEXT    NOT NULL DEFAULT '',
    action       TEXT    NOT NULL,
    details      TEXT    NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    CONSTRAINT activity_target CHECK (
        (file_id IS NOT NULL AND folder_id IS NULL) OR
        (file_id IS NULL     AND folder_id IS NOT NULL)
    )
);
CREATE INDEX drive.idx_files_al_file   ON activity_log(file_id,   created_at);
CREATE INDEX drive.idx_files_al_folder ON activity_log(folder_id, created_at);

CREATE TABLE drive.webdav_tokens (
    user_id      BLOB NOT NULL PRIMARY KEY,
    token        TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    last_used_at TEXT
);

CREATE TABLE drive.remote_connections (
    id           BLOB    NOT NULL PRIMARY KEY,
    owner_id     BLOB    NOT NULL,
    name         TEXT    NOT NULL,
    provider     TEXT    NOT NULL
                     CHECK (provider IN ('webdav', 'nextcloud', 'owncloud', 'sftp', 'ftp', 'smb', 'nfs', 'gdrive', 'dropbox', 's3')),
    config_enc   BLOB    NOT NULL,
    mount_name   TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'disconnected'
                     CHECK (status IN ('connected', 'disconnected', 'error', 'syncing')),
    last_connected_at TEXT,
    last_error   TEXT,
    remote_quota_bytes  INTEGER,
    remote_used_bytes   INTEGER,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    UNIQUE (owner_id, mount_name)
);
CREATE INDEX drive.idx_files_remotes_owner  ON remote_connections(owner_id);
CREATE INDEX drive.idx_files_remotes_status ON remote_connections(status);

CREATE TABLE drive.remote_cache (
    id            BLOB    NOT NULL PRIMARY KEY,
    connection_id BLOB    NOT NULL REFERENCES remote_connections(id) ON DELETE CASCADE,
    remote_path   TEXT    NOT NULL,
    name          TEXT    NOT NULL,
    is_dir        BOOLEAN NOT NULL DEFAULT FALSE,
    size_bytes    INTEGER,
    modified_at   TEXT,
    mime_type     TEXT,
    remote_id     TEXT,
    etag          TEXT,
    cached_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    UNIQUE (connection_id, remote_path)
);
CREATE INDEX drive.idx_files_rc_conn_path ON remote_cache(connection_id, remote_path);

CREATE TABLE drive.search_index (
    file_id       BLOB    NOT NULL PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    owner_id      BLOB    NOT NULL,
    name          TEXT    NOT NULL,
    mime_type     TEXT    NOT NULL DEFAULT '',
    folder_id     BLOB,
    content_text  TEXT,
    name_norm     TEXT    NOT NULL DEFAULT '',
    content_norm  TEXT    NOT NULL DEFAULT '',
    embedding     TEXT,
    embedding_dim INTEGER,
    phash         INTEGER,
    indexed_hash  TEXT,
    lang          TEXT    NOT NULL DEFAULT 'simple',
    is_trashed    BOOLEAN NOT NULL DEFAULT FALSE,
    indexed_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX drive.idx_files_si_owner     ON search_index (owner_id, is_trashed);
CREATE INDEX drive.idx_files_si_name_norm ON search_index (owner_id, name_norm);
CREATE INDEX drive.idx_search_index_phash ON search_index (owner_id);

CREATE TABLE drive.idempotency_keys (
    id_hash      TEXT    NOT NULL PRIMARY KEY,
    user_id      BLOB    NOT NULL,
    method       TEXT    NOT NULL,
    path         TEXT    NOT NULL,
    status_code  INTEGER NOT NULL,
    content_type TEXT,
    body         BLOB    NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    expires_at   TEXT    NOT NULL
);
CREATE INDEX drive.idx_drive_idem_expires ON idempotency_keys(expires_at);

CREATE TABLE drive.tags (
    id          BLOB    NOT NULL PRIMARY KEY,
    owner_id    BLOB    NOT NULL,
    name        TEXT    NOT NULL,
    color       TEXT    NOT NULL DEFAULT 'gray',
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    CONSTRAINT tags_owner_name_unique UNIQUE (owner_id, name)
);
CREATE INDEX drive.idx_drive_tags_owner ON tags(owner_id);

CREATE TABLE drive.file_tags (
    tag_id     BLOB NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
    file_id    BLOB NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    owner_id   BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    PRIMARY KEY (tag_id, file_id)
);
CREATE INDEX drive.idx_drive_file_tags_file  ON file_tags(file_id);
CREATE INDEX drive.idx_drive_file_tags_owner ON file_tags(owner_id);

CREATE TABLE drive.folder_tags (
    tag_id     BLOB NOT NULL REFERENCES tags(id)    ON DELETE CASCADE,
    folder_id  BLOB NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    owner_id   BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    PRIMARY KEY (tag_id, folder_id)
);
CREATE INDEX drive.idx_drive_folder_tags_folder ON folder_tags(folder_id);
CREATE INDEX drive.idx_drive_folder_tags_owner  ON folder_tags(owner_id);

CREATE TABLE drive.file_locks (
    file_id     BLOB NOT NULL PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    locked_by   BLOB NOT NULL,
    reason      TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    expires_at  TEXT
);
CREATE INDEX drive.idx_drive_file_locks_user ON file_locks(locked_by);

CREATE TABLE drive.saved_searches (
    id          BLOB    NOT NULL PRIMARY KEY,
    owner_id    BLOB    NOT NULL,
    name        TEXT    NOT NULL,
    query       TEXT    NOT NULL DEFAULT '',
    filters     TEXT    NOT NULL,
    icon        TEXT,
    color       TEXT,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX drive.idx_drive_saved_searches_owner ON saved_searches(owner_id, position);

CREATE TABLE drive.file_access (
    file_id            BLOB    NOT NULL PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    owner_id           BLOB    NOT NULL,
    view_count         INTEGER NOT NULL DEFAULT 0,
    download_count     INTEGER NOT NULL DEFAULT 0,
    last_viewed_at     TEXT,
    last_downloaded_at TEXT
);
CREATE INDEX drive.idx_drive_file_access_owner ON file_access(owner_id);
CREATE INDEX drive.idx_drive_file_access_views ON file_access(owner_id, view_count);

CREATE TABLE drive.recent_opens (
    owner_id   BLOB NOT NULL,
    file_id    BLOB NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    module_id  TEXT NOT NULL DEFAULT '',
    opened_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    PRIMARY KEY (owner_id, file_id, module_id)
);
CREATE INDEX drive.idx_drive_recent_opens_owner ON recent_opens(owner_id, opened_at);

CREATE TABLE drive.pdf_comments (
    id          BLOB    NOT NULL PRIMARY KEY,
    file_id     BLOB    NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    author_id   BLOB    NOT NULL,
    page        INTEGER NOT NULL CHECK (page >= 1),
    x           REAL    NOT NULL,
    y           REAL    NOT NULL,
    w           REAL    NOT NULL,
    h           REAL    NOT NULL,
    body        TEXT    NOT NULL,
    resolved    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX drive.idx_drive_pdf_comments_file ON pdf_comments(file_id);

CREATE TABLE drive.tombstones (
    id         BLOB    NOT NULL PRIMARY KEY,
    owner_id   BLOB    NOT NULL,
    kind       TEXT    NOT NULL,
    path       TEXT,
    change_seq INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT    NOT NULL
);
CREATE INDEX drive.idx_drive_tomb_owner_seq ON tombstones(owner_id, change_seq);

CREATE TABLE drive.change_counter (
    domain TEXT   NOT NULL PRIMARY KEY,
    n      INTEGER NOT NULL
);

-- System directory: shared read-only space (fonts, dictionaries…), owned by the
-- reserved user. UUIDs are written as their 16-byte binary (BLOB) form.
INSERT INTO drive.folders (id, owner_id, parent_id, name, path, is_protected) VALUES
  (X'000000000000000000000000000005a1', X'00000000000000000000000000000001', NULL,
   'System', '/System', TRUE),
  (X'000000000000000000000000000005a2', X'00000000000000000000000000000001',
   X'000000000000000000000000000005a1', 'Fonts', '/System/Fonts', TRUE),
  (X'000000000000000000000000000005a3', X'00000000000000000000000000000001',
   X'000000000000000000000000000005a1', 'Dictionaries', '/System/Dictionaries', TRUE);
