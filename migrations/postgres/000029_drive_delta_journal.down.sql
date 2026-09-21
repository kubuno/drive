CREATE SEQUENCE IF NOT EXISTS drive.change_seq;
DROP TABLE IF EXISTS drive.change_counter;
ALTER TABLE drive.files      ALTER COLUMN change_seq SET DEFAULT nextval('drive.change_seq');
ALTER TABLE drive.folders    ALTER COLUMN change_seq SET DEFAULT nextval('drive.change_seq');
ALTER TABLE drive.tombstones ALTER COLUMN change_seq SET DEFAULT nextval('drive.change_seq');
ALTER TABLE drive.tombstones ALTER COLUMN deleted_at SET DEFAULT NOW();
