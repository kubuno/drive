-- Per-file access counters: how often a file is viewed/downloaded, and when.
-- Powers the "frequently used" view, the details panel and richer activity.
CREATE TABLE drive.file_access (
    file_id            UUID PRIMARY KEY REFERENCES drive.files(id) ON DELETE CASCADE,
    owner_id           UUID NOT NULL,
    view_count         BIGINT NOT NULL DEFAULT 0,
    download_count     BIGINT NOT NULL DEFAULT 0,
    last_viewed_at     TIMESTAMPTZ,
    last_downloaded_at TIMESTAMPTZ
);

CREATE INDEX idx_drive_file_access_owner ON drive.file_access(owner_id);
CREATE INDEX idx_drive_file_access_views ON drive.file_access(owner_id, view_count DESC);
