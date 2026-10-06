-- Protection au niveau FICHIER (les apps peuvent protéger/déprotéger leurs fichiers,
-- ex. Flow protège un .kbflw tant que son exécution se poursuit).
ALTER TABLE drive.files ADD COLUMN IF NOT EXISTS is_protected BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_drive_files_protected ON drive.files(owner_id) WHERE is_protected = TRUE;
