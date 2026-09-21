-- Partage de fichiers et dossiers
CREATE TABLE drive.shares (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id        UUID NOT NULL,
    -- Cible du partage (fichier ou dossier, pas les deux)
    file_id         UUID REFERENCES drive.files(id)   ON DELETE CASCADE,
    folder_id       UUID REFERENCES drive.folders(id) ON DELETE CASCADE,
    -- Token public (pour lien de partage sans authentification)
    token           VARCHAR(64) UNIQUE,
    -- Destinataire nommé (optionnel — partage interne)
    recipient_id    UUID,                               -- core.users.id
    -- Permissions
    can_download    BOOLEAN NOT NULL DEFAULT TRUE,
    can_upload      BOOLEAN NOT NULL DEFAULT FALSE,
    can_delete      BOOLEAN NOT NULL DEFAULT FALSE,
    -- Protection par mot de passe (hash)
    password_hash   VARCHAR(255),
    -- Expiration
    expires_at      TIMESTAMPTZ,
    -- Statistiques
    download_count  INTEGER NOT NULL DEFAULT 0,
    max_downloads   INTEGER,
    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ,
    CONSTRAINT shares_target CHECK (
        (file_id IS NOT NULL AND folder_id IS NULL) OR
        (file_id IS NULL AND folder_id IS NOT NULL)
    )
);

CREATE INDEX idx_files_shares_owner     ON drive.shares(owner_id);
CREATE INDEX idx_files_shares_file      ON drive.shares(file_id)   WHERE file_id IS NOT NULL;
CREATE INDEX idx_files_shares_folder    ON drive.shares(folder_id) WHERE folder_id IS NOT NULL;
CREATE INDEX idx_files_shares_token     ON drive.shares(token)     WHERE token IS NOT NULL AND revoked_at IS NULL;
CREATE INDEX idx_files_shares_recipient ON drive.shares(recipient_id) WHERE recipient_id IS NOT NULL;

CREATE TRIGGER shares_updated_at
    BEFORE UPDATE ON drive.shares
    FOR EACH ROW EXECUTE FUNCTION drive.set_updated_at();
