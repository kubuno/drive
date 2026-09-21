DROP INDEX IF EXISTS drive.idx_drive_files_protected;
ALTER TABLE drive.files DROP COLUMN IF EXISTS is_protected;
