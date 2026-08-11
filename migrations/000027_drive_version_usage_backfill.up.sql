-- Version histories become a billed, user-reclaimable category.
--
-- Until now `drive.file_versions` rows were never added to the incremental
-- quota counter `core.users.used_bytes`: a revision cost the disk but not the
-- account. The module now charges each revision on creation and refunds it on
-- deletion, pruning and purge (`DELETE /:id/versions`), which only balances out
-- if the revisions already on disk are charged too — otherwise the first purge
-- would refund bytes nobody was ever charged for and walk the counter down.
--
-- This is a one-shot reconciliation of the pre-existing rows. It is guarded on
-- `core.users` existing: on a fresh install the core's own schema may not be
-- migrated yet, and there is nothing to reconcile there anyway.
--
-- Nothing is created here; the listing reads its counters straight from
-- `drive.file_versions` through an indexed lateral aggregate over the current
-- page only, so no denormalized column is needed.
DO $$
BEGIN
    IF to_regclass('core.users') IS NOT NULL THEN
        UPDATE core.users u
        SET    used_bytes = u.used_bytes + agg.bytes
        FROM (
            SELECT owner_id, SUM(size_bytes)::bigint AS bytes
            FROM   drive.file_versions
            GROUP  BY owner_id
        ) agg
        WHERE u.id = agg.owner_id
          AND agg.bytes > 0;
    END IF;
END
$$;

-- Purging a whole history reads every row of one file at once; the existing
-- index on (file_id) already serves it. The account-wide summary
-- (`GET /versions/summary`) sums by owner, served by idx_files_versions_owner.
-- Both are covered — this migration adds no object.
