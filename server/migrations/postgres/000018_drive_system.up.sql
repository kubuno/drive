-- Répertoire SYSTÈME : espace partagé en LECTURE à tous les utilisateurs (polices,
-- dictionnaires, fichiers utiles…), géré uniquement par les administrateurs via l'API.
-- Propriétaire réservé 00000000-0000-0000-0000-000000000001 (jamais un vrai utilisateur).
-- Idempotent (ON CONFLICT) : sûr à rejouer.
INSERT INTO drive.folders (id, owner_id, parent_id, name, path, is_protected) VALUES
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000001', NULL,
   'System', '/System', TRUE),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000005a1', 'Fonts', '/System/Fonts', TRUE),
  ('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000005a1', 'Dictionaries', '/System/Dictionaries', TRUE)
ON CONFLICT (id) DO NOTHING;
