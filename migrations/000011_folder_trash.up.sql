ALTER TABLE drive.folders
    ADD COLUMN IF NOT EXISTS is_trashed  BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS trashed_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_files_folders_trashed
    ON drive.folders(owner_id, is_trashed);
