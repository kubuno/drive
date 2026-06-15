-- Renomme les fichiers de contenu Office existants (.json) vers leurs extensions
-- kubuno natives, en alignant aussi l'extension normalisée et le mime_type.
-- Seul le nom LOGIQUE change : le contenu physique (storage_path) n'est pas touché,
-- et l'ouverture se fait par file_id/métadonnée — rien n'est cassé.
-- Les brouillons (.drafts/<entity_id>.json, subtype 'draft') ne sont PAS concernés.

UPDATE drive.files SET
    name       = regexp_replace(name, '\.json$', '.kbdoc'),
    extension  = 'kbdoc',
    mime_type  = 'application/vnd.kubuno.document+json',
    updated_at = NOW()
WHERE name LIKE '%.json'
  AND metadata->>'module'  = 'office'
  AND metadata->>'subtype' = 'document';

UPDATE drive.files SET
    name       = regexp_replace(name, '\.json$', '.kbcal'),
    extension  = 'kbcal',
    mime_type  = 'application/vnd.kubuno.spreadsheet+json',
    updated_at = NOW()
WHERE name LIKE '%.json'
  AND metadata->>'module'  = 'office'
  AND metadata->>'subtype' = 'spreadsheet';

UPDATE drive.files SET
    name       = regexp_replace(name, '\.json$', '.kbsld'),
    extension  = 'kbsld',
    mime_type  = 'application/vnd.kubuno.presentation+json',
    updated_at = NOW()
WHERE name LIKE '%.json'
  AND metadata->>'module'  = 'office'
  AND metadata->>'subtype' = 'presentation';

UPDATE drive.files SET
    name       = regexp_replace(name, '\.json$', '.kbdia'),
    extension  = 'kbdia',
    mime_type  = 'application/vnd.kubuno.diagram+json',
    updated_at = NOW()
WHERE name LIKE '%.json'
  AND metadata->>'module'  = 'office'
  AND metadata->>'subtype' = 'diagram';

UPDATE drive.files SET
    name       = regexp_replace(name, '\.json$', '.kbprj'),
    extension  = 'kbprj',
    mime_type  = 'application/vnd.kubuno.project+json',
    updated_at = NOW()
WHERE name LIKE '%.json'
  AND metadata->>'module' = 'office'
  AND metadata->>'type'   = 'project';
