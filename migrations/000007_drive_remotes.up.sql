-- Connexions aux stockages distants (Google Drive, Dropbox, Nextcloud, WebDAV, SMB, NFS, FTP…)
CREATE TABLE IF NOT EXISTS drive.remote_connections (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id     UUID        NOT NULL,
    name         VARCHAR(255) NOT NULL,
    provider     VARCHAR(50) NOT NULL
                     CHECK (provider IN ('webdav', 'nextcloud', 'owncloud', 'sftp', 'ftp', 'smb', 'nfs', 'gdrive', 'dropbox', 's3')),
    -- Configuration chiffrée (URL, credentials, OAuth tokens…)
    -- Jamais exposée directement en clair via l'API
    config_enc   BYTEA       NOT NULL,          -- AES-256-GCM encrypted JSON
    -- Chemin de montage virtuel dans le VFS du module files
    -- ex: "remote/gdrive-work" → accessible via /files/api/v1/items?parent=remote/gdrive-work/
    mount_name   VARCHAR(100) NOT NULL,
    -- Infos de statut et synchro
    status       VARCHAR(20) NOT NULL DEFAULT 'disconnected'
                     CHECK (status IN ('connected', 'disconnected', 'error', 'syncing')),
    last_connected_at TIMESTAMPTZ,
    last_error   TEXT,
    -- Quota/infos rapportées par le provider
    remote_quota_bytes  BIGINT,
    remote_used_bytes   BIGINT,
    -- Timestamps
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_id, mount_name)
);

CREATE INDEX IF NOT EXISTS idx_files_remotes_owner  ON drive.remote_connections(owner_id);
CREATE INDEX IF NOT EXISTS idx_files_remotes_status ON drive.remote_connections(status);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'remote_connections_updated_at'
          AND tgrelid = 'drive.remote_connections'::regclass
    ) THEN
        CREATE TRIGGER remote_connections_updated_at
            BEFORE UPDATE ON drive.remote_connections
            FOR EACH ROW EXECUTE FUNCTION drive.set_updated_at();
    END IF;
END $$;

-- Cache des métadonnées distantes (pour navigation rapide sans requête réseau)
CREATE TABLE IF NOT EXISTS drive.remote_cache (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    connection_id UUID       NOT NULL REFERENCES drive.remote_connections(id) ON DELETE CASCADE,
    remote_path  TEXT        NOT NULL,
    name         VARCHAR(500) NOT NULL,
    is_dir       BOOLEAN     NOT NULL DEFAULT FALSE,
    size_bytes   BIGINT,
    modified_at  TIMESTAMPTZ,
    mime_type    VARCHAR(255),
    remote_id    TEXT,           -- identifiant opaque du provider (gdrive file id, etc.)
    etag         TEXT,
    cached_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (connection_id, remote_path)
);

CREATE INDEX IF NOT EXISTS idx_files_rc_conn_path ON drive.remote_cache(connection_id, remote_path);
