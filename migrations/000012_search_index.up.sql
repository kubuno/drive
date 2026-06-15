-- Module files — index de recherche (plein-texte + embeddings optionnels)
-- pg_trgm et unaccent sont déjà installés (migrations core). Pas de pgvector requis :
-- les embeddings sont stockés en real[] et la similarité cosinus est calculée applicativement.

CREATE TABLE IF NOT EXISTS drive.search_index (
    file_id       UUID PRIMARY KEY REFERENCES drive.files(id) ON DELETE CASCADE,
    owner_id      UUID NOT NULL,
    name          TEXT NOT NULL,
    mime_type     TEXT NOT NULL DEFAULT '',
    folder_id     UUID,
    content_text  TEXT,                              -- texte extrait, plafonné (~1 Mo)
    tsv           TSVECTOR,                          -- maintenu par trigger (unaccent non IMMUTABLE)
    embedding     REAL[],                            -- NULL sauf si embeddings activés
    embedding_dim INTEGER,                           -- garde contre les mélanges de dimensions
    indexed_hash  VARCHAR(64),                       -- reflète drive.content_hash au moment de l'indexation
    lang          TEXT NOT NULL DEFAULT 'simple',
    is_trashed    BOOLEAN NOT NULL DEFAULT FALSE,    -- miroir pour filtrage bon marché
    indexed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Construction de la tsvector (nom = poids A, contenu = poids D), config 'simple' + unaccent.
CREATE OR REPLACE FUNCTION drive.search_index_tsv() RETURNS TRIGGER AS $$
BEGIN
    NEW.tsv :=
        setweight(to_tsvector('simple', unaccent(coalesce(NEW.name, ''))), 'A') ||
        setweight(to_tsvector('simple', unaccent(coalesce(NEW.content_text, ''))), 'D');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS search_index_tsv_trg ON drive.search_index;
CREATE TRIGGER search_index_tsv_trg
    BEFORE INSERT OR UPDATE OF name, content_text ON drive.search_index
    FOR EACH ROW EXECUTE FUNCTION drive.search_index_tsv();

CREATE INDEX IF NOT EXISTS idx_files_si_tsv       ON drive.search_index USING GIN (tsv);
CREATE INDEX IF NOT EXISTS idx_files_si_name_trgm ON drive.search_index USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_files_si_owner     ON drive.search_index (owner_id, is_trashed);
