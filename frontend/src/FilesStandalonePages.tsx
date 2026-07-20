// Standalone pop-out pages: the desktop client opens these SPA routes in a real
// OS window (window.kubunoDesktop.openWindow). Each page loads the file named by
// `?file=<id>` and seeds the matching store — the floating component itself is
// already mounted app-wide through the `app-dialogs` slot, so the page renders
// only a neutral backdrop (no double mount).
import { useEffect, useRef, useState } from 'react'
import { api } from '@kubuno/sdk'
import { useFilesMediaPlayerStore, useFilesPaintStore } from '@kubuno/drive'
import type { FileItem } from '@kubuno/drive'

function useQueryFile(): { file: FileItem | null; error: string | null } {
  const [file, setFile]   = useState<FileItem | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('file')
    if (!id) {
      setError('Paramètre ?file manquant')
      return
    }
    api.get<{ file: FileItem }>(`/drive/${id}`)
      .then(r => setFile(r.data.file))
      .catch(() => setError('Fichier introuvable'))
  }, [])

  return { file, error }
}

function StandaloneBackdrop({ error }: { error: string | null }) {
  return (
    <div className="flex items-center justify-center w-full h-full min-h-[60vh] text-sm text-text-secondary">
      {error ?? ''}
    </div>
  )
}

/** /drive/player?file=<id> — the Drive audio player in its own window.
 *
 * Seeds ONCE: when the media module is active its bridge immediately transfers
 * the file to the media player and CLEARS the drive store — re-seeding on store
 * change would loop forever (React #185). No auto window-close either: with the
 * bridge, the drive store is not the player's lifecycle owner. */
export default function DrivePlayerPage() {
  const { file, error } = useQueryFile()
  const seeded = useRef(false)

  useEffect(() => {
    if (file && !seeded.current) {
      seeded.current = true
      useFilesMediaPlayerStore.getState().open(file)
    }
  }, [file])

  return <StandaloneBackdrop error={error} />
}

/** /drive/paint?file=<id> — the Drive Paint editor in its own window. */
export function DrivePaintPage() {
  const { file, error } = useQueryFile()
  const seeded = useRef(false)

  useEffect(() => {
    if (file && !seeded.current) {
      seeded.current = true
      useFilesPaintStore.getState().openEditor(file)
    }
  }, [file])

  // Closing the editor in a popped-out window closes the OS window (best-effort;
  // the paint store is not intercepted by any bridge, unlike the audio one).
  useEffect(() => {
    let opened = false
    const unsub = useFilesPaintStore.subscribe(s => {
      if (s.open) opened = true
      else if (opened) window.close()
    })
    return unsub
  }, [])

  return <StandaloneBackdrop error={error} />
}
