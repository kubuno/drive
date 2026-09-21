CREATE TABLE drive.webdav_tokens (
    user_id      UUID PRIMARY KEY,
    token        TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);
