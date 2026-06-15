-- Icône (nom Lucide) des dossiers — utilisée pour les dossiers appartenant à un
-- module ou sous-module (ex. PaintSharp/Apex, Office/Scripts, Flow).
ALTER TABLE drive.folders ADD COLUMN IF NOT EXISTS icon VARCHAR(50);
