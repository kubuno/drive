ALTER TABLE drive.search_index
    ALTER COLUMN embedding TYPE REAL[] USING NULL;
DROP INDEX IF EXISTS drive.idx_files_si_name_norm;
ALTER TABLE drive.search_index DROP COLUMN IF EXISTS content_norm;
ALTER TABLE drive.search_index DROP COLUMN IF EXISTS name_norm;
ALTER TABLE drive.search_index ADD COLUMN IF NOT EXISTS tsv TSVECTOR;
