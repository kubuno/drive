ALTER TABLE drive.folders
    DROP COLUMN IF EXISTS is_trashed,
    DROP COLUMN IF EXISTS trashed_at;

DROP INDEX IF EXISTS idx_files_folders_trashed;
