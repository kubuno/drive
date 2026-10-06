-- Idempotency for drive writes.
--
-- Drive routes are proxied by the core, so they bypass the core's idempotency
-- middleware. This table gives the drive its own dedup: a replayed mutation
-- carrying the same Idempotency-Key returns the stored response instead of
-- creating a duplicate (e.g. an offline client retrying an upload whose response
-- was lost).
--
-- id_hash = SHA-256(user_id | method | path | key). The user is the
-- X-Kubuno-User-Id injected by the core proxy, so keys are naturally per-user.
CREATE TABLE drive.idempotency_keys (
    id_hash      VARCHAR(64) PRIMARY KEY,
    user_id      UUID        NOT NULL,
    method       VARCHAR(10) NOT NULL,
    path         TEXT        NOT NULL,
    status_code  INTEGER     NOT NULL,
    content_type TEXT,
    body         BYTEA       NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_drive_idem_expires ON drive.idempotency_keys(expires_at);
