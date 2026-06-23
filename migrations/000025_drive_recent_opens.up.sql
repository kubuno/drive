-- Centralised "recently opened files" log: which application opened which file
-- and when. Apps record opens here (instead of each keeping its own list), so
-- recent-files handling lives in ONE place. Capped at the 30 most recent per user.
CREATE TABLE drive.recent_opens (
    owner_id   UUID NOT NULL,
    file_id    UUID NOT NULL REFERENCES drive.files(id) ON DELETE CASCADE,
    module_id  VARCHAR(100) NOT NULL DEFAULT '',
    opened_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (owner_id, file_id, module_id)
);

CREATE INDEX idx_drive_recent_opens_owner ON drive.recent_opens(owner_id, opened_at DESC);
