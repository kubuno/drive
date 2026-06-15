DROP TABLE IF EXISTS drive.file_versions;
ALTER TABLE drive.folders DROP COLUMN IF EXISTS versioning_enabled;
ALTER TABLE drive.files   DROP COLUMN IF EXISTS versioning_enabled;
