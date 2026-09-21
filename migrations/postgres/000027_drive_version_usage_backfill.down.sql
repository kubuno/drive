-- Give back the bytes the up-migration charged for the pre-existing revisions.
DO $$
BEGIN
    IF to_regclass('core.users') IS NOT NULL THEN
        UPDATE core.users u
        SET    used_bytes = GREATEST(0, u.used_bytes - agg.bytes)
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
