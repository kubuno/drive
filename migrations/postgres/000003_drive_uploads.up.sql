-- Sessions d'upload multipart (gros fichiers en chunks)
CREATE TABLE drive.upload_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id        UUID NOT NULL,
    folder_id       UUID REFERENCES drive.folders(id) ON DELETE SET NULL,
    -- Métadonnées du fichier cible
    filename        VARCHAR(1000) NOT NULL,
    mime_type       VARCHAR(255) NOT NULL DEFAULT 'application/octet-stream',
    total_size      BIGINT NOT NULL,
    chunk_size      BIGINT NOT NULL,
    total_chunks    INTEGER NOT NULL,
    -- Progression
    chunks_received INTEGER NOT NULL DEFAULT 0,
    -- État : pending → uploading → assembling → done | failed
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'uploading', 'assembling', 'done', 'failed')),
    error           TEXT,
    -- Fichier créé à la fin (quand status = done)
    file_id         UUID REFERENCES drive.files(id) ON DELETE SET NULL,
    -- Chemin temporaire des chunks
    temp_path       TEXT NOT NULL,
    -- Expiration automatique si upload abandonné
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_files_uploads_owner   ON drive.upload_sessions(owner_id);
CREATE INDEX idx_files_uploads_status  ON drive.upload_sessions(status);
CREATE INDEX idx_files_uploads_expires ON drive.upload_sessions(expires_at)
    WHERE status NOT IN ('done', 'failed');

CREATE TRIGGER upload_sessions_updated_at
    BEFORE UPDATE ON drive.upload_sessions
    FOR EACH ROW EXECUTE FUNCTION drive.set_updated_at();
