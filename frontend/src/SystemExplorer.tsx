/**
 * SystemExplorer — route `/drive/system`. Rend la MÊME zone d'exploration que
 * « Mon Drive » (`StorageExplorer`), branchée sur le répertoire SYSTÈME partagé.
 * Lecture pour tous, écriture réservée aux administrateurs (le backend garde
 * l'écriture ; l'entrée de barre latérale n'est affichée qu'aux admins).
 *
 * Cas particulier : le dossier `System/Fonts` reçoit une vue dédiée façon dossier
 * « Polices » de Windows (regroupement par famille + barre de détails).
 */
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { StorageExplorer, systemSource } from '@kubuno/drive'
import FontsExplorer from './FontsExplorer'

// Dossier système seedé (ids fixes, cf. backend system seed).
const FONTS_FOLDER_ID = '00000000-0000-0000-0000-0000000005a2'

export default function SystemExplorer() {
  const source = useMemo(() => systemSource(), [])
  const [params, setParams] = useSearchParams()
  const folder = params.get('folder')

  if (folder === FONTS_FOLDER_ID) {
    return (
      <FontsExplorer
        folderId={folder}
        onExit={() => { const p = new URLSearchParams(params); p.delete('folder'); setParams(p) }}
      />
    )
  }

  return <StorageExplorer source={source} title="System" pathParam="folder" />
}
