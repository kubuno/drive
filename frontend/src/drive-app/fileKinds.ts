import type { FileItem } from '@kubuno/drive'
import { isTextFile } from '@kubuno/drive'
import { is3dFile } from '../Files3DViewer'
import { isFontFile } from '../FilesFontViewer'

// File-kind predicates shared by the Drive views, the openers and the previewer.

/** True for archive files (by MIME or extension). */
export function isArchiveFile(f: FileItem): boolean {
  const nm = f.name.toLowerCase()
  return f.mime_type.includes('zip') || f.mime_type.includes('tar') || f.mime_type.includes('gzip')
    || nm.endsWith('.zip') || nm.endsWith('.tar') || nm.endsWith('.tar.gz') || nm.endsWith('.tgz')
}

/** True for files that open in a native full-screen / floating preview — the
 *  set the previewer's ←/→ navigation cycles through. */
export function isPreviewable(f: FileItem): boolean {
  return f.mime_type.startsWith('image/') || f.mime_type.startsWith('video/')
    || f.mime_type.startsWith('audio/') || f.mime_type === 'application/pdf'
    || is3dFile(f) || isFontFile(f) || isArchiveFile(f) || isTextFile(f)
}
