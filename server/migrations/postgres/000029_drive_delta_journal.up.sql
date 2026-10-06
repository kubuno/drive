-- Move the delta-sync layer off the PostgreSQL SEQUENCE + triggers onto the
-- portable, application-driven kubuno_db::journal primitive.
--
-- A single monotonic counter (domain 'drive') stamps every file, folder and
-- tombstone change, exactly as the old global SEQUENCE did — so a client's merge
-- of the three sources by change_seq keeps a single global order. The bump and
-- the tombstone are now written from Rust at every write site (see src/sync.rs).

-- The BEFORE UPDATE bump trigger and the AFTER DELETE tombstone triggers go; the
-- change_seq column and the tombstones table stay (the app maintains them now).
DROP TRIGGER  IF EXISTS files_change_seq    ON drive.files;
DROP TRIGGER  IF EXISTS folders_change_seq  ON drive.folders;
DROP FUNCTION IF EXISTS drive.bump_change_seq();
DROP TRIGGER  IF EXISTS files_tombstone     ON drive.files;
DROP TRIGGER  IF EXISTS folders_tombstone   ON drive.folders;
DROP FUNCTION IF EXISTS drive.tombstone_file();
DROP FUNCTION IF EXISTS drive.tombstone_folder();

-- The column DEFAULT drew from the sequence; the app now supplies change_seq.
ALTER TABLE drive.files      ALTER COLUMN change_seq DROP DEFAULT;
ALTER TABLE drive.folders    ALTER COLUMN change_seq DROP DEFAULT;
ALTER TABLE drive.tombstones ALTER COLUMN change_seq DROP DEFAULT;
ALTER TABLE drive.tombstones ALTER COLUMN deleted_at DROP DEFAULT;

-- One shared counter table per schema; next_seq keys it by domain.
CREATE TABLE IF NOT EXISTS drive.change_counter (
    domain TEXT   NOT NULL PRIMARY KEY,
    n      BIGINT NOT NULL
);

-- Seed the single 'drive' domain past the highest sequence any live row or
-- tombstone already carries, so new sequences never collide with existing ones.
INSERT INTO drive.change_counter (domain, n)
SELECT 'drive', GREATEST(
    COALESCE((SELECT MAX(change_seq) FROM drive.files), 0),
    COALESCE((SELECT MAX(change_seq) FROM drive.folders), 0),
    COALESCE((SELECT MAX(change_seq) FROM drive.tombstones), 0)
)
ON CONFLICT (domain) DO NOTHING;

DROP SEQUENCE IF EXISTS drive.change_seq;
