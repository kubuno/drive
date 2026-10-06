-- Rows moved to the trash by the up migration stay there (restorable).
DROP INDEX IF EXISTS drive.files_live_name_unique;
DROP TABLE IF EXISTS drive.duplicate_files;
