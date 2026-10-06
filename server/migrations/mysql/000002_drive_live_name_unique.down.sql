-- Rows moved to the trash by the up migration stay there (restorable).
DROP INDEX files_live_name_unique ON files;
ALTER TABLE files DROP COLUMN live_name_key;
DROP TABLE IF EXISTS duplicate_files;
