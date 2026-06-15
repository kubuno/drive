-- Dossiers cachés : exclus du navigateur de fichiers. Utilisé pour les dossiers
-- d'assets internes des modules (ex. images de présentations Office dans
-- Office/.media/<id>) qui ne doivent pas encombrer l'arborescence de l'utilisateur.
ALTER TABLE drive.folders ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;
