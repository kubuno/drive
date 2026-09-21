-- Cooperative file locks: a user marks a file as locked to prevent accidental
-- destructive changes (trash/delete) and to signal exclusive editing to others
-- in shared contexts. One lock per file.
CREATE TABLE drive.file_locks (
    file_id     UUID PRIMARY KEY REFERENCES drive.files(id) ON DELETE CASCADE,
    locked_by   UUID NOT NULL,                       -- core.users.id
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ                          -- optional auto-expiry (NULL = until unlocked)
);

CREATE INDEX idx_drive_file_locks_user ON drive.file_locks(locked_by);
