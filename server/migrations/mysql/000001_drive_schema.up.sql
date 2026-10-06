-- MySQL / MariaDB — the `drive` database is created by kubuno-db's schema setup
-- before the migrator runs, so there is no CREATE DATABASE here. This single
-- file declares the FINAL shape the PostgreSQL side reached across its
-- 000001..000029 migrations (versioning, tags, locks, saved searches, access
-- counters, recent opens, pdf comments, the normalized search columns and the
-- delta journal).
--
-- Differences from PostgreSQL, and why:
--   * UUID -> BINARY(16): what sqlx encodes a `uuid::Uuid` as on MySQL.
--   * No DEFAULT on `id`: MySQL has no gen_random_uuid() and no RETURNING, so
--     the process supplies every primary key.
--   * TIMESTAMPTZ -> DATETIME(6); every value written is UTC (the pool pins
--     `time_zone = '+00:00'`). updated_at uses ON UPDATE CURRENT_TIMESTAMP(6).
--   * JSONB -> JSON; BYTEA -> LONGBLOB; REAL[] -> JSON (embedding). The app binds
--     JSON columns explicitly (MariaDB has no literal default for them).
--   * Full-text search is the normalized-column form (name_norm / content_norm,
--     filled in Rust): no tsvector, no GIN, no unaccent, no pg_trgm.
--   * The delta layer is the journal (change_counter + per-row change_seq) plus
--     the tombstones table; no sequence, no triggers.
--   * Partial indexes (WHERE ...) become plain indexes (MySQL has none).
--   * utf8mb4_bin so a UNIQUE key stays case- and accent-sensitive.

CREATE TABLE folders (
    id          BINARY(16)   NOT NULL PRIMARY KEY,
    owner_id    BINARY(16)   NOT NULL,
    parent_id   BINARY(16)   NULL,
    name        VARCHAR(255) NOT NULL,
    path        TEXT         NOT NULL,
    is_starred  BOOLEAN      NOT NULL DEFAULT FALSE,
    versioning_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    color       VARCHAR(20)  NULL,
    is_protected BOOLEAN     NOT NULL DEFAULT FALSE,
    is_trashed  BOOLEAN      NOT NULL DEFAULT FALSE,
    trashed_at  DATETIME(6)  NULL,
    icon        VARCHAR(50)  NULL,
    is_hidden   BOOLEAN      NOT NULL DEFAULT FALSE,
    change_seq  BIGINT       NOT NULL DEFAULT 0,
    created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                             ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT folders_name_unique_per_parent UNIQUE (owner_id, parent_id, name),
    FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_files_folders_owner   ON folders(owner_id);
CREATE INDEX idx_files_folders_parent  ON folders(parent_id);
CREATE INDEX idx_files_folders_path     ON folders(owner_id, path(255));
CREATE INDEX idx_files_folders_trashed ON folders(owner_id, is_trashed);
CREATE INDEX idx_drive_folders_seq     ON folders(owner_id, change_seq);

CREATE TABLE files (
    id              BINARY(16)    NOT NULL PRIMARY KEY,
    owner_id        BINARY(16)    NOT NULL,
    folder_id       BINARY(16)    NULL,
    name            VARCHAR(1000) NOT NULL,
    extension       VARCHAR(20)   NULL,
    mime_type       VARCHAR(255)  NOT NULL DEFAULT 'application/octet-stream',
    size_bytes      BIGINT        NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
    storage_path    TEXT          NOT NULL,
    content_hash    VARCHAR(64)   NULL,
    metadata        JSON          NOT NULL,
    is_starred      BOOLEAN       NOT NULL DEFAULT FALSE,
    is_trashed      BOOLEAN       NOT NULL DEFAULT FALSE,
    trashed_at      DATETIME(6)   NULL,
    has_thumbnail   BOOLEAN       NOT NULL DEFAULT FALSE,
    versioning_enabled BOOLEAN    NOT NULL DEFAULT FALSE,
    is_protected    BOOLEAN       NOT NULL DEFAULT FALSE,
    change_seq      BIGINT        NOT NULL DEFAULT 0,
    created_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                  ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_files_files_owner   ON files(owner_id);
CREATE INDEX idx_files_files_folder  ON files(folder_id);
CREATE INDEX idx_files_files_trashed ON files(owner_id, is_trashed);
CREATE INDEX idx_files_files_starred ON files(owner_id, is_starred);
CREATE INDEX idx_files_files_mime    ON files(owner_id, mime_type);
CREATE INDEX idx_files_files_hash    ON files(content_hash);
CREATE INDEX idx_drive_files_seq     ON files(owner_id, change_seq);
CREATE INDEX idx_drive_files_protected ON files(owner_id, is_protected);

CREATE TABLE shares (
    id              BINARY(16)   NOT NULL PRIMARY KEY,
    owner_id        BINARY(16)   NOT NULL,
    file_id         BINARY(16)   NULL,
    folder_id       BINARY(16)   NULL,
    token           VARCHAR(64)  NULL UNIQUE,
    recipient_id    BINARY(16)   NULL,
    can_download    BOOLEAN      NOT NULL DEFAULT TRUE,
    can_upload      BOOLEAN      NOT NULL DEFAULT FALSE,
    can_delete      BOOLEAN      NOT NULL DEFAULT FALSE,
    password_hash   VARCHAR(255) NULL,
    expires_at      DATETIME(6)  NULL,
    download_count  INT          NOT NULL DEFAULT 0,
    max_downloads   INT          NULL,
    created_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                 ON UPDATE CURRENT_TIMESTAMP(6),
    revoked_at      DATETIME(6)  NULL,
    CONSTRAINT shares_target CHECK (
        (file_id IS NOT NULL AND folder_id IS NULL) OR
        (file_id IS NULL AND folder_id IS NOT NULL)
    ),
    FOREIGN KEY (file_id)   REFERENCES files(id)   ON DELETE CASCADE,
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_files_shares_owner     ON shares(owner_id);
CREATE INDEX idx_files_shares_file      ON shares(file_id);
CREATE INDEX idx_files_shares_folder    ON shares(folder_id);
CREATE INDEX idx_files_shares_recipient ON shares(recipient_id);

CREATE TABLE upload_sessions (
    id              BINARY(16)    NOT NULL PRIMARY KEY,
    owner_id        BINARY(16)    NOT NULL,
    folder_id       BINARY(16)    NULL,
    filename        VARCHAR(1000) NOT NULL,
    mime_type       VARCHAR(255)  NOT NULL DEFAULT 'application/octet-stream',
    total_size      BIGINT        NOT NULL,
    chunk_size      BIGINT        NOT NULL,
    total_chunks    INT           NOT NULL,
    chunks_received INT           NOT NULL DEFAULT 0,
    status          VARCHAR(20)   NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'uploading', 'assembling', 'done', 'failed')),
    error           TEXT          NULL,
    file_id         BINARY(16)    NULL,
    temp_path       TEXT          NOT NULL,
    overwrite       BOOLEAN       NOT NULL DEFAULT FALSE,
    expires_at      DATETIME(6)   NOT NULL,
    created_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                  ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL,
    FOREIGN KEY (file_id)   REFERENCES files(id)   ON DELETE SET NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_files_uploads_owner   ON upload_sessions(owner_id);
CREATE INDEX idx_files_uploads_status  ON upload_sessions(status);
CREATE INDEX idx_files_uploads_expires ON upload_sessions(expires_at);

CREATE TABLE file_versions (
    id              BINARY(16)  NOT NULL PRIMARY KEY,
    file_id         BINARY(16)  NOT NULL,
    owner_id        BINARY(16)  NOT NULL,
    version_number  INT         NOT NULL,
    storage_path    TEXT        NOT NULL,
    size_bytes      BIGINT      NOT NULL DEFAULT 0,
    content_hash    VARCHAR(64) NULL,
    comment         TEXT        NULL,
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT file_versions_unique UNIQUE (file_id, version_number),
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_files_versions_file  ON file_versions(file_id);
CREATE INDEX idx_files_versions_owner ON file_versions(owner_id);

CREATE TABLE activity_log (
    id           BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    file_id      BINARY(16)   NULL,
    folder_id    BINARY(16)   NULL,
    user_id      BINARY(16)   NOT NULL,
    user_display VARCHAR(255) NOT NULL DEFAULT '',
    action       VARCHAR(50)  NOT NULL,
    details      JSON         NOT NULL,
    created_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT activity_target CHECK (
        (file_id IS NOT NULL AND folder_id IS NULL) OR
        (file_id IS NULL     AND folder_id IS NOT NULL)
    ),
    FOREIGN KEY (file_id)   REFERENCES files(id)   ON DELETE CASCADE,
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_files_al_file   ON activity_log(file_id,   created_at);
CREATE INDEX idx_files_al_folder ON activity_log(folder_id, created_at);

CREATE TABLE webdav_tokens (
    user_id      BINARY(16)  NOT NULL PRIMARY KEY,
    token        TEXT        NOT NULL,
    created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    last_used_at DATETIME(6) NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE remote_connections (
    id           BINARY(16)   NOT NULL PRIMARY KEY,
    owner_id     BINARY(16)   NOT NULL,
    name         VARCHAR(255) NOT NULL,
    provider     VARCHAR(50)  NOT NULL
                     CHECK (provider IN ('webdav', 'nextcloud', 'owncloud', 'sftp', 'ftp', 'smb', 'nfs', 'gdrive', 'dropbox', 's3')),
    config_enc   LONGBLOB     NOT NULL,
    mount_name   VARCHAR(100) NOT NULL,
    status       VARCHAR(20)  NOT NULL DEFAULT 'disconnected'
                     CHECK (status IN ('connected', 'disconnected', 'error', 'syncing')),
    last_connected_at DATETIME(6) NULL,
    last_error   TEXT         NULL,
    remote_quota_bytes  BIGINT NULL,
    remote_used_bytes   BIGINT NULL,
    created_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                              ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE (owner_id, mount_name)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_files_remotes_owner  ON remote_connections(owner_id);
CREATE INDEX idx_files_remotes_status ON remote_connections(status);

CREATE TABLE remote_cache (
    id            BINARY(16)   NOT NULL PRIMARY KEY,
    connection_id BINARY(16)   NOT NULL,
    remote_path   TEXT         NOT NULL,
    name          VARCHAR(500) NOT NULL,
    is_dir        BOOLEAN      NOT NULL DEFAULT FALSE,
    size_bytes    BIGINT       NULL,
    modified_at   DATETIME(6)  NULL,
    mime_type     VARCHAR(255) NULL,
    remote_id     TEXT         NULL,
    etag          TEXT         NULL,
    cached_at     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE (connection_id, remote_path(255)),
    FOREIGN KEY (connection_id) REFERENCES remote_connections(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_files_rc_conn_path ON remote_cache(connection_id, remote_path(255));

CREATE TABLE search_index (
    file_id       BINARY(16)  NOT NULL PRIMARY KEY,
    owner_id      BINARY(16)  NOT NULL,
    name          TEXT        NOT NULL,
    mime_type     TEXT        NOT NULL,
    folder_id     BINARY(16)  NULL,
    content_text  TEXT        NULL,
    name_norm     TEXT        NOT NULL,
    content_norm  TEXT        NOT NULL,
    embedding     JSON        NULL,
    embedding_dim INT         NULL,
    phash         BIGINT      NULL,
    indexed_hash  VARCHAR(64) NULL,
    lang          VARCHAR(20) NOT NULL DEFAULT 'simple',
    is_trashed    BOOLEAN     NOT NULL DEFAULT FALSE,
    indexed_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_files_si_owner     ON search_index (owner_id, is_trashed);
CREATE INDEX idx_files_si_name_norm ON search_index (owner_id, name_norm(255));
CREATE INDEX idx_search_index_phash ON search_index (owner_id);

CREATE TABLE idempotency_keys (
    id_hash      VARCHAR(64) NOT NULL PRIMARY KEY,
    user_id      BINARY(16)  NOT NULL,
    method       VARCHAR(10) NOT NULL,
    path         TEXT        NOT NULL,
    status_code  INT         NOT NULL,
    content_type TEXT        NULL,
    body         LONGBLOB    NOT NULL,
    created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    expires_at   DATETIME(6) NOT NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_drive_idem_expires ON idempotency_keys(expires_at);

CREATE TABLE tags (
    id          BINARY(16)  NOT NULL PRIMARY KEY,
    owner_id    BINARY(16)  NOT NULL,
    name        VARCHAR(64) NOT NULL,
    color       VARCHAR(20) NOT NULL DEFAULT 'gray',
    created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                            ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT tags_owner_name_unique UNIQUE (owner_id, name)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_drive_tags_owner ON tags(owner_id);

CREATE TABLE file_tags (
    tag_id     BINARY(16)  NOT NULL,
    file_id    BINARY(16)  NOT NULL,
    owner_id   BINARY(16)  NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (tag_id, file_id),
    FOREIGN KEY (tag_id)  REFERENCES tags(id)  ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_drive_file_tags_file  ON file_tags(file_id);
CREATE INDEX idx_drive_file_tags_owner ON file_tags(owner_id);

CREATE TABLE folder_tags (
    tag_id     BINARY(16)  NOT NULL,
    folder_id  BINARY(16)  NOT NULL,
    owner_id   BINARY(16)  NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (tag_id, folder_id),
    FOREIGN KEY (tag_id)    REFERENCES tags(id)    ON DELETE CASCADE,
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_drive_folder_tags_folder ON folder_tags(folder_id);
CREATE INDEX idx_drive_folder_tags_owner  ON folder_tags(owner_id);

CREATE TABLE file_locks (
    file_id     BINARY(16)  NOT NULL PRIMARY KEY,
    locked_by   BINARY(16)  NOT NULL,
    reason      TEXT        NULL,
    created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    expires_at  DATETIME(6) NULL,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_drive_file_locks_user ON file_locks(locked_by);

CREATE TABLE saved_searches (
    id          BINARY(16)   NOT NULL PRIMARY KEY,
    owner_id    BINARY(16)   NOT NULL,
    name        VARCHAR(120) NOT NULL,
    query       TEXT         NOT NULL,
    filters     JSON         NOT NULL,
    icon        VARCHAR(50)  NULL,
    color       VARCHAR(20)  NULL,
    position    INT          NOT NULL DEFAULT 0,
    created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                             ON UPDATE CURRENT_TIMESTAMP(6)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_drive_saved_searches_owner ON saved_searches(owner_id, position);

CREATE TABLE file_access (
    file_id            BINARY(16)  NOT NULL PRIMARY KEY,
    owner_id           BINARY(16)  NOT NULL,
    view_count         BIGINT      NOT NULL DEFAULT 0,
    download_count     BIGINT      NOT NULL DEFAULT 0,
    last_viewed_at     DATETIME(6) NULL,
    last_downloaded_at DATETIME(6) NULL,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_drive_file_access_owner ON file_access(owner_id);
CREATE INDEX idx_drive_file_access_views ON file_access(owner_id, view_count);

CREATE TABLE recent_opens (
    owner_id   BINARY(16)   NOT NULL,
    file_id    BINARY(16)   NOT NULL,
    module_id  VARCHAR(100) NOT NULL DEFAULT '',
    opened_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (owner_id, file_id, module_id),
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_drive_recent_opens_owner ON recent_opens(owner_id, opened_at);

CREATE TABLE pdf_comments (
    id          BINARY(16)  NOT NULL PRIMARY KEY,
    file_id     BINARY(16)  NOT NULL,
    author_id   BINARY(16)  NOT NULL,
    page        INT         NOT NULL CHECK (page >= 1),
    x           DOUBLE      NOT NULL,
    y           DOUBLE      NOT NULL,
    w           DOUBLE      NOT NULL,
    h           DOUBLE      NOT NULL,
    body        TEXT        NOT NULL,
    resolved    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                            ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_drive_pdf_comments_file ON pdf_comments(file_id);

CREATE TABLE tombstones (
    id         BINARY(16)  NOT NULL PRIMARY KEY,
    owner_id   BINARY(16)  NOT NULL,
    kind       VARCHAR(10) NOT NULL,
    path       TEXT        NULL,
    change_seq BIGINT      NOT NULL DEFAULT 0,
    deleted_at DATETIME(6) NOT NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_drive_tomb_owner_seq ON tombstones(owner_id, change_seq);

CREATE TABLE change_counter (
    domain VARCHAR(64) NOT NULL PRIMARY KEY,
    n      BIGINT      NOT NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- System directory: shared read-only space (fonts, dictionaries…), owned by the
-- reserved user. UUIDs are written as their 16-byte binary form.
INSERT INTO folders (id, owner_id, parent_id, name, path, is_protected) VALUES
  (X'000000000000000000000000000005a1', X'00000000000000000000000000000001', NULL,
   'System', '/System', TRUE),
  (X'000000000000000000000000000005a2', X'00000000000000000000000000000001',
   X'000000000000000000000000000005a1', 'Fonts', '/System/Fonts', TRUE),
  (X'000000000000000000000000000005a3', X'00000000000000000000000000000001',
   X'000000000000000000000000000005a1', 'Dictionaries', '/System/Dictionaries', TRUE);
