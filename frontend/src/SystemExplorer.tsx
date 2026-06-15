/**
 * SystemExplorer — route `/drive/system`. Rend la MÊME zone d'exploration que
 * « Mon Drive » (`StorageExplorer`), branchée sur le répertoire SYSTÈME partagé.
 * Lecture pour tous, écriture réservée aux administrateurs (le backend garde
 * l'écriture ; l'entrée de barre latérale n'est affichée qu'aux admins).
 */
import { useMemo } from 'react'
import { StorageExplorer, systemSource } from '@kubuno/drive'

export default function SystemExplorer() {
  const source = useMemo(() => systemSource(), [])
  return <StorageExplorer source={source} title="System" pathParam="folder" />
}
