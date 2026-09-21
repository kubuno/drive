-- Portable full-text search: replace the PostgreSQL-only tsvector/pg_trgm/unaccent
-- pipeline with normalized TEXT columns filled in Rust (kubuno_db::search), so the
-- same stems and ranking hold on PostgreSQL, MySQL/MariaDB and SQLite.
--
-- The `name`/`content_text` are reduced to Snowball French stems and deaccented at
-- write time into `name_norm`/`content_norm`; a query is put through the same
-- normalize() and matched with a portable LIKE.

ALTER TABLE drive.search_index ADD COLUMN IF NOT EXISTS name_norm    TEXT NOT NULL DEFAULT '';
ALTER TABLE drive.search_index ADD COLUMN IF NOT EXISTS content_norm TEXT NOT NULL DEFAULT '';

-- The tsvector column, its maintenance trigger and the GIN indexes are gone.
DROP TRIGGER   IF EXISTS search_index_tsv_trg ON drive.search_index;
DROP FUNCTION  IF EXISTS drive.search_index_tsv();
DROP INDEX     IF EXISTS drive.idx_files_si_tsv;
DROP INDEX     IF EXISTS drive.idx_files_si_name_trgm;
ALTER TABLE drive.search_index DROP COLUMN IF EXISTS tsv;

-- Embeddings become a portable JSON array of floats (MySQL/SQLite have no REAL[]).
ALTER TABLE drive.search_index
    ALTER COLUMN embedding TYPE JSONB USING to_jsonb(embedding);

-- A cheap prefix index for the normalized name (LIKE '%term%' cannot use it, but
-- it still helps the equality/prefix probes and keeps the owner filter tight).
CREATE INDEX IF NOT EXISTS idx_files_si_name_norm ON drive.search_index (owner_id, name_norm);
