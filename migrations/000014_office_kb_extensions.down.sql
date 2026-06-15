-- Réversion : ré-attribue l'ancien nom .json + mime application/json.

UPDATE drive.files SET
    name = regexp_replace(name, '\.kbdoc$', '.json'), extension = 'json',
    mime_type = 'application/json', updated_at = NOW()
WHERE name LIKE '%.kbdoc' AND metadata->>'module' = 'office' AND metadata->>'subtype' = 'document';

UPDATE drive.files SET
    name = regexp_replace(name, '\.kbcal$', '.json'), extension = 'json',
    mime_type = 'application/json', updated_at = NOW()
WHERE name LIKE '%.kbcal' AND metadata->>'module' = 'office' AND metadata->>'subtype' = 'spreadsheet';

UPDATE drive.files SET
    name = regexp_replace(name, '\.kbsld$', '.json'), extension = 'json',
    mime_type = 'application/json', updated_at = NOW()
WHERE name LIKE '%.kbsld' AND metadata->>'module' = 'office' AND metadata->>'subtype' = 'presentation';

UPDATE drive.files SET
    name = regexp_replace(name, '\.kbdia$', '.json'), extension = 'json',
    mime_type = 'application/json', updated_at = NOW()
WHERE name LIKE '%.kbdia' AND metadata->>'module' = 'office' AND metadata->>'subtype' = 'diagram';

UPDATE drive.files SET
    name = regexp_replace(name, '\.kbprj$', '.json'), extension = 'json',
    mime_type = 'application/json', updated_at = NOW()
WHERE name LIKE '%.kbprj' AND metadata->>'module' = 'office' AND metadata->>'type' = 'project';
