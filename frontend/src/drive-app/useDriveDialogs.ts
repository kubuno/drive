import { useState } from 'react'
import type { FileItem, InfoTarget, ShareTarget } from '@kubuno/drive'
import type { TagDialogTarget } from '../TagUI'
import type { AdvShareTarget, MoveTarget, RenameTarget } from './types'

/** Targets of the modal dialogs opened from the menus, cards and previewers. */
export function useDriveDialogs() {
  const [renameTarget,    setRenameTarget]    = useState<RenameTarget>(null)
  const [moveTarget,      setMoveTarget]      = useState<MoveTarget>(null)
  const [shareTarget,     setShareTarget]     = useState<ShareTarget | null>(null)
  const [infoTarget,      setInfoTarget]      = useState<InfoTarget | null>(null)
  const [versionTarget,   setVersionTarget]   = useState<FileItem | null>(null)
  const [tagDialogTarget, setTagDialogTarget] = useState<TagDialogTarget | null>(null)
  const [imageEditFile,   setImageEditFile]   = useState<FileItem | null>(null)
  const [advShareTarget,  setAdvShareTarget]  = useState<AdvShareTarget | null>(null)

  return {
    renameTarget, setRenameTarget,
    moveTarget, setMoveTarget,
    shareTarget, setShareTarget,
    infoTarget, setInfoTarget,
    versionTarget, setVersionTarget,
    tagDialogTarget, setTagDialogTarget,
    imageEditFile, setImageEditFile,
    advShareTarget, setAdvShareTarget,
  }
}

export type DriveDialogs = ReturnType<typeof useDriveDialogs>
