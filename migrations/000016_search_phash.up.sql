-- Empreinte perceptuelle (dHash 64 bits) des images, pour la recherche d'images
-- similaires (distance de Hamming). Calculée par le worker d'indexation.
ALTER TABLE drive.search_index ADD COLUMN IF NOT EXISTS phash BIGINT;
CREATE INDEX IF NOT EXISTS idx_search_index_phash ON drive.search_index(owner_id) WHERE phash IS NOT NULL;
