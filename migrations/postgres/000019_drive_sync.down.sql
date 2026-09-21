DROP TRIGGER IF EXISTS files_tombstone   ON drive.files;
DROP TRIGGER IF EXISTS folders_tombstone ON drive.folders;
DROP FUNCTION IF EXISTS drive.tombstone_file();
DROP FUNCTION IF EXISTS drive.tombstone_folder();
DROP TABLE IF EXISTS drive.tombstones;

DROP TRIGGER IF EXISTS files_change_seq   ON drive.files;
DROP TRIGGER IF EXISTS folders_change_seq ON drive.folders;
DROP FUNCTION IF EXISTS drive.bump_change_seq();

DROP INDEX IF EXISTS drive.idx_drive_files_seq;
DROP INDEX IF EXISTS drive.idx_drive_folders_seq;
ALTER TABLE drive.files   DROP COLUMN IF EXISTS change_seq;
ALTER TABLE drive.folders DROP COLUMN IF EXISTS change_seq;

DROP SEQUENCE IF EXISTS drive.change_seq;
