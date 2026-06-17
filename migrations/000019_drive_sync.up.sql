-- Delta synchronisation support for offline-first clients (mobile/desktop).
--
-- A schema-global monotonic sequence stamps every file/folder change. Clients
-- send the last `change_seq` they saw as a cursor and receive everything newer,
-- including soft-deletes (is_trashed bumps change_seq) and hard-deletes
-- (captured as tombstones, so a removed item is still visible in the delta).

CREATE SEQUENCE IF NOT EXISTS drive.change_seq;

ALTER TABLE drive.files
    ADD COLUMN IF NOT EXISTS change_seq BIGINT NOT NULL DEFAULT nextval('drive.change_seq');
ALTER TABLE drive.folders
    ADD COLUMN IF NOT EXISTS change_seq BIGINT NOT NULL DEFAULT nextval('drive.change_seq');

CREATE INDEX IF NOT EXISTS idx_drive_files_seq   ON drive.files(owner_id, change_seq);
CREATE INDEX IF NOT EXISTS idx_drive_folders_seq ON drive.folders(owner_id, change_seq);

-- Bump change_seq on every UPDATE (INSERT is covered by the column DEFAULT).
-- Runs alongside the existing updated_at trigger.
CREATE OR REPLACE FUNCTION drive.bump_change_seq() RETURNS TRIGGER AS $$
BEGIN
    NEW.change_seq = nextval('drive.change_seq');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS files_change_seq   ON drive.files;
DROP TRIGGER IF EXISTS folders_change_seq ON drive.folders;
CREATE TRIGGER files_change_seq   BEFORE UPDATE ON drive.files
    FOR EACH ROW EXECUTE FUNCTION drive.bump_change_seq();
CREATE TRIGGER folders_change_seq BEFORE UPDATE ON drive.folders
    FOR EACH ROW EXECUTE FUNCTION drive.bump_change_seq();

-- Tombstones: a hard DELETE leaves a record so clients learn the item is gone.
CREATE TABLE IF NOT EXISTS drive.tombstones (
    id         UUID PRIMARY KEY,            -- former file/folder id
    owner_id   UUID NOT NULL,
    kind       VARCHAR(10) NOT NULL,        -- 'file' | 'folder'
    path       TEXT,                        -- folder path or file name, for client display
    change_seq BIGINT NOT NULL DEFAULT nextval('drive.change_seq'),
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_drive_tomb_owner_seq ON drive.tombstones(owner_id, change_seq);

-- Auto-create tombstones on hard delete, regardless of the code path.
CREATE OR REPLACE FUNCTION drive.tombstone_file() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO drive.tombstones (id, owner_id, kind, path)
    VALUES (OLD.id, OLD.owner_id, 'file', OLD.name);
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION drive.tombstone_folder() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO drive.tombstones (id, owner_id, kind, path)
    VALUES (OLD.id, OLD.owner_id, 'folder', OLD.path);
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS files_tombstone   ON drive.files;
DROP TRIGGER IF EXISTS folders_tombstone ON drive.folders;
CREATE TRIGGER files_tombstone   AFTER DELETE ON drive.files
    FOR EACH ROW EXECUTE FUNCTION drive.tombstone_file();
CREATE TRIGGER folders_tombstone AFTER DELETE ON drive.folders
    FOR EACH ROW EXECUTE FUNCTION drive.tombstone_folder();
