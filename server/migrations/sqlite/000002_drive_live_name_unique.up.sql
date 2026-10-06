-- One live file per name and folder (see the PostgreSQL migration 000030 for
-- the full rationale). Duplicates are recorded and trashed, never deleted; the
-- module merges them into their keeper at start-up (services::duplicates).

CREATE TABLE IF NOT EXISTS drive.duplicate_files (
    file_id     BLOB NOT NULL PRIMARY KEY,
    keeper_id   BLOB NOT NULL,
    owner_id    BLOB NOT NULL,
    recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

INSERT OR IGNORE INTO drive.duplicate_files (file_id, keeper_id, owner_id)
SELECT id, keeper_id, owner_id
FROM (
    SELECT id, owner_id,
           FIRST_VALUE(id) OVER (PARTITION BY owner_id, folder_id, name
                                 ORDER BY updated_at DESC, created_at DESC, id DESC) AS keeper_id,
           ROW_NUMBER()    OVER (PARTITION BY owner_id, folder_id, name
                                 ORDER BY updated_at DESC, created_at DESC, id DESC) AS rn
    FROM drive.files
    WHERE is_trashed = FALSE
) ranked
WHERE rn > 1;

UPDATE drive.files
   SET is_trashed = TRUE, trashed_at = strftime('%Y-%m-%d %H:%M:%f', 'now')
 WHERE id IN (SELECT file_id FROM drive.duplicate_files)
   AND is_trashed = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS drive.files_live_name_unique
    ON files (owner_id, IFNULL(folder_id, X'00000000000000000000000000000000'), name)
    WHERE is_trashed = FALSE;
