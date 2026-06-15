-- Module files — schéma principal
CREATE SCHEMA IF NOT EXISTS drive;

-- Arborescence de dossiers (hiérarchie via parent_id)
CREATE TABLE drive.folders (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id    UUID NOT NULL,                                      -- core.users.id (référence logique)
    parent_id   UUID REFERENCES drive.folders(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    path        TEXT NOT NULL,                                      -- chemin matérialisé ex: /photos/vacances
    is_starred  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT folders_name_unique_per_parent UNIQUE (owner_id, parent_id, name)
);

CREATE INDEX idx_files_folders_owner  ON drive.folders(owner_id);
CREATE INDEX idx_files_folders_parent ON drive.folders(parent_id);
CREATE INDEX idx_files_folders_path   ON drive.folders(owner_id, path);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION drive.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER folders_updated_at
    BEFORE UPDATE ON drive.folders
    FOR EACH ROW EXECUTE FUNCTION drive.set_updated_at();

-- Fichiers
CREATE TABLE drive.files (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id        UUID NOT NULL,
    folder_id       UUID REFERENCES drive.folders(id) ON DELETE SET NULL,
    -- Nom original (affiché à l'utilisateur)
    name            VARCHAR(1000) NOT NULL,
    -- Extension normalisée (ex: "jpg", "pdf")
    extension       VARCHAR(20),
    -- Type MIME détecté à l'upload
    mime_type       VARCHAR(255) NOT NULL DEFAULT 'application/octet-stream',
    -- Taille en bytes
    size_bytes      BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
    -- Chemin de stockage physique (géré par kubuno-storage)
    storage_path    TEXT NOT NULL,
    -- Hash SHA-256 du contenu (déduplication future)
    content_hash    VARCHAR(64),
    -- Métadonnées extraites (dimensions image, durée vidéo, etc.)
    metadata        JSONB NOT NULL DEFAULT '{}',
    -- État
    is_starred      BOOLEAN NOT NULL DEFAULT FALSE,
    is_trashed      BOOLEAN NOT NULL DEFAULT FALSE,
    trashed_at      TIMESTAMPTZ,
    -- Thumbnail généré ?
    has_thumbnail   BOOLEAN NOT NULL DEFAULT FALSE,
    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_files_files_owner     ON drive.files(owner_id);
CREATE INDEX idx_files_files_folder    ON drive.files(folder_id);
CREATE INDEX idx_files_files_trashed   ON drive.files(owner_id, is_trashed);
CREATE INDEX idx_files_files_starred   ON drive.files(owner_id, is_starred) WHERE is_starred = TRUE;
CREATE INDEX idx_files_files_mime      ON drive.files(owner_id, mime_type);
CREATE INDEX idx_files_files_hash      ON drive.files(content_hash) WHERE content_hash IS NOT NULL;

CREATE TRIGGER files_updated_at
    BEFORE UPDATE ON drive.files
    FOR EACH ROW EXECUTE FUNCTION drive.set_updated_at();
