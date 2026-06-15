-- Versionnage optionnel par fichier ou par dossier
ALTER TABLE drive.files   ADD COLUMN IF NOT EXISTS versioning_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE drive.folders ADD COLUMN IF NOT EXISTS versioning_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Historique des versions
CREATE TABLE drive.file_versions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_id         UUID NOT NULL REFERENCES drive.files(id) ON DELETE CASCADE,
    owner_id        UUID NOT NULL,
    version_number  INTEGER NOT NULL,
    storage_path    TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL DEFAULT 0,
    content_hash    VARCHAR(64),
    comment         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT file_versions_unique UNIQUE (file_id, version_number)
);

CREATE INDEX idx_files_versions_file  ON drive.file_versions(file_id);
CREATE INDEX idx_files_versions_owner ON drive.file_versions(owner_id);
