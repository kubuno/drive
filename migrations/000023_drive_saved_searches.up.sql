-- Saved searches ("smart folders"): a named, persisted query the user recalls
-- from the sidebar. Stores the free-text query plus the structured filter set.
CREATE TABLE drive.saved_searches (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id    UUID NOT NULL,
    name        VARCHAR(120) NOT NULL,
    query       TEXT NOT NULL DEFAULT '',
    filters     JSONB NOT NULL DEFAULT '{}',   -- mirrors the advanced filter panel
    icon        VARCHAR(50),
    color       VARCHAR(20),
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_drive_saved_searches_owner ON drive.saved_searches(owner_id, position);

CREATE TRIGGER saved_searches_updated_at
    BEFORE UPDATE ON drive.saved_searches
    FOR EACH ROW EXECUTE FUNCTION drive.set_updated_at();
