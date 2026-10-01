-- One live file per name and folder.
--
-- Concurrent writes (two module saves of a new draft, a save racing the disk
-- watcher's scan) could both find a name free and both insert a row, leaving
-- several LIVE rows with the same owner, folder and name — usually over one
-- shared blob. A partial unique index now makes that impossible; the write paths
-- turn a conflict into an update of the winning row (overwrite) or a numbered
-- name.
--
-- Existing duplicates must go before the index can exist. This migration only
-- does what is safe in plain SQL: in each group it keeps the most recently
-- updated row, RECORDS every other row in `duplicate_files` (with the row it
-- duplicates) and moves it to the trash. Nothing is deleted and no blob is
-- touched. At start-up the module then merges each recorded row into its keeper
-- (services::duplicates): versions, shares, comments, tags and activity move
-- over, distinct contents are kept as a version of the keeper, and the row is
-- removed only then. `kubuno-drive drive:fsck` lists what is still pending.

CREATE TABLE IF NOT EXISTS drive.duplicate_files (
    file_id     UUID        NOT NULL PRIMARY KEY,
    keeper_id   UUID        NOT NULL,
    owner_id    UUID        NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO drive.duplicate_files (file_id, keeper_id, owner_id)
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
WHERE rn > 1
ON CONFLICT (file_id) DO NOTHING;

UPDATE drive.files
   SET is_trashed = TRUE, trashed_at = NOW()
 WHERE id IN (SELECT file_id FROM drive.duplicate_files)
   AND is_trashed = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS files_live_name_unique
    ON drive.files (owner_id, COALESCE(folder_id, '00000000-0000-0000-0000-000000000000'::uuid), name)
    WHERE is_trashed = FALSE;
