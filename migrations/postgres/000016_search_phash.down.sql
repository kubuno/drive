DROP INDEX IF EXISTS drive.idx_search_index_phash;
ALTER TABLE drive.search_index DROP COLUMN IF EXISTS phash;
