-- Anchored comments on documents (PDF preview): a comment is pinned to a
-- rectangular region of a given page. Coordinates are normalized to [0,1]
-- relative to the page box so they stay correct at any zoom / render size.
CREATE TABLE drive.pdf_comments (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_id     UUID NOT NULL REFERENCES drive.files(id) ON DELETE CASCADE,
    author_id   UUID NOT NULL,                       -- core.users.id
    page        INT  NOT NULL CHECK (page >= 1),
    x           DOUBLE PRECISION NOT NULL,           -- normalized 0..1
    y           DOUBLE PRECISION NOT NULL,
    w           DOUBLE PRECISION NOT NULL,
    h           DOUBLE PRECISION NOT NULL,
    body        TEXT NOT NULL,
    resolved    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_drive_pdf_comments_file ON drive.pdf_comments(file_id);
