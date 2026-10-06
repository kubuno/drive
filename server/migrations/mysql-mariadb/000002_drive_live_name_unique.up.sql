-- MariaDB variant of migrations/mysql/000002_drive_live_name_unique.up.sql: runs instead of it on
-- MariaDB only and is recorded under its checksum (kubuno_db::MySqlVariants).
--
-- The only change: `live_name_key` is a VIRTUAL generated column, not STORED.
-- A stored generated column may not depend on `folder_id`, whose foreign key
-- is ON DELETE SET NULL; MariaDB refuses it with 1901 (`folder_id` cannot be
-- used in the GENERATED ALWAYS AS clause).
-- An indexed VIRTUAL column has no such restriction, and its UNIQUE index
-- enforces exactly the same rule (the index stores the computed key).
--
-- One live file per name and folder (see the PostgreSQL migration 000030 for
-- the full rationale). Duplicates are recorded and trashed, never deleted; the
-- module merges them into their keeper at start-up (services::duplicates).
--
-- MySQL/MariaDB has no partial index, and `name` (VARCHAR(1000), utf8mb4) is
-- too long for an index key. A stored generated column holds a SHA-256 of
-- (owner, folder, name) for live rows and NULL for trashed ones; a UNIQUE index
-- on it admits any number of NULLs, i.e. constrains live rows only.

CREATE TABLE IF NOT EXISTS duplicate_files (
    file_id     BINARY(16)  NOT NULL PRIMARY KEY,
    keeper_id   BINARY(16)  NOT NULL,
    owner_id    BINARY(16)  NOT NULL,
    recorded_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

INSERT IGNORE INTO duplicate_files (file_id, keeper_id, owner_id)
SELECT id, keeper_id, owner_id
FROM (
    SELECT id, owner_id,
           FIRST_VALUE(id) OVER (PARTITION BY owner_id, folder_id, name
                                 ORDER BY updated_at DESC, created_at DESC, id DESC) AS keeper_id,
           ROW_NUMBER()    OVER (PARTITION BY owner_id, folder_id, name
                                 ORDER BY updated_at DESC, created_at DESC, id DESC) AS rn
    FROM files
    WHERE is_trashed = FALSE
) ranked
WHERE rn > 1;

UPDATE files
   SET is_trashed = TRUE, trashed_at = NOW(6)
 WHERE id IN (SELECT file_id FROM duplicate_files)
   AND is_trashed = FALSE;

ALTER TABLE files
    ADD COLUMN live_name_key BINARY(32)
        AS (CASE WHEN is_trashed THEN NULL
                 ELSE UNHEX(SHA2(CONCAT(HEX(owner_id), '/',
                                        HEX(COALESCE(folder_id, UNHEX('00000000000000000000000000000000'))), '/',
                                        name), 256))
            END) VIRTUAL;

CREATE UNIQUE INDEX files_live_name_unique ON files (live_name_key);
