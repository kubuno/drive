import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { filesApi, isTextFile, useFilesMediaPlayerStore, useFilesVideoPlayerStore, type FileItem } from '@kubuno/drive'
import { api, FileTypeRegistry, ModuleServiceRegistry } from '@kubuno/sdk'
import { is3dFile } from '../Files3DViewer'
import { isFontFile } from '../FilesFontViewer'
import { isArchiveFile } from './fileKinds'

/** Native viewers state plus the "open a file" strategies. */
export interface DriveViewers {
  lightboxFile: FileItem | null
  setLightboxFile: (f: FileItem | null) => void
  model3dFile: FileItem | null
  setModel3dFile: (f: FileItem | null) => void
  fontFile: FileItem | null
  setFontFile: (f: FileItem | null) => void
  pdfFile: FileItem | null
  setPdfFile: (f: FileItem | null) => void
  archiveFile: FileItem | null
  setArchiveFile: (f: FileItem | null) => void
  textFile: FileItem | null
  setTextFile: (f: FileItem | null) => void
  videoFile: FileItem | null
  closeVideoFile: () => void
  videoRestorePos: number
  videoClearPos: () => void
  /** Ids of the files currently being played (audio + video). */
  playingFileIds: Set<string>
  /** Opens a file honouring the "open with" preference. */
  openFile: (file: FileItem) => void
  /** Opens a file directly in its native preview (previewer ←/→ navigation). */
  openPreview: (file: FileItem) => void
}

export function useDriveViewers(): DriveViewers {
  const routerNavigate = useNavigate()

  const [lightboxFile, setLightboxFile] = useState<FileItem | null>(null)
  const [model3dFile,  setModel3dFile]  = useState<FileItem | null>(null)
  const [fontFile,     setFontFile]     = useState<FileItem | null>(null)
  const [pdfFile,      setPdfFile]      = useState<FileItem | null>(null)
  const [archiveFile,  setArchiveFile]  = useState<FileItem | null>(null)
  const [textFile,     setTextFile]     = useState<FileItem | null>(null)

  const videoFile      = useFilesVideoPlayerStore(s => s.file)
  const openVideoFile  = useFilesVideoPlayerStore(s => s.open)
  const closeVideoFile = useFilesVideoPlayerStore(s => s.close)
  const videoRestorePos = useFilesVideoPlayerStore(s => s.restorePosition)
  const videoClearPos   = useFilesVideoPlayerStore(s => s._clearRestorePosition)

  const openAudio = useFilesMediaPlayerStore(s => s.open)
  const playingAudioFileId = useFilesMediaPlayerStore(s => s.file?.id ?? null)
  const playingVideoFileId = videoFile?.id ?? null
  const playingFileIds = useMemo(() => {
    const s = new Set<string>()
    if (playingAudioFileId) s.add(playingAudioFileId)
    if (playingVideoFileId) s.add(playingVideoFileId)
    return s
  }, [playingAudioFileId, playingVideoFileId])

  const openFile = useCallback((file: FileItem) => {
    // Record a view (best-effort) for access stats and the "frequent" list.
    void api.post(`/drive/${file.id}/view`).catch(() => {})
    // 1. Explicit "open with" preference (FileTypeRegistry moduleId, else legacy service)
    const openWith = typeof file.metadata?.['open_with'] === 'string' ? file.metadata['open_with'] as string : null
    if (openWith) {
      const decl = FileTypeRegistry.get(openWith)
      if (decl?.open) { decl.open(file, routerNavigate); return }
      const handled = ModuleServiceRegistry.call<boolean>(openWith, 'openFile', file, routerNavigate)
      if (handled) return
    }
    // 2. Native behaviour based on the MIME type (media, pdf, archives…)
    if (file.mime_type.startsWith('image/'))          { setLightboxFile(file); return }
    if (file.mime_type.startsWith('video/'))          { openVideoFile(file);   return }
    if (file.mime_type.startsWith('audio/'))          { openAudio(file);       return }
    if (is3dFile(file))                               { setModel3dFile(file);  return }
    if (isFontFile(file))                             { setFontFile(file);     return }
    if (file.mime_type === 'application/pdf')         { setPdfFile(file);      return }
    {
      const nm = file.name.toLowerCase()
      if (file.mime_type.includes('zip') || file.mime_type.includes('tar') || file.mime_type.includes('gzip')
          || nm.endsWith('.zip') || nm.endsWith('.tar') || nm.endsWith('.tar.gz') || nm.endsWith('.tgz')) {
        setArchiveFile(file); return
      }
    }
    // 3. Text (txt, md, csv, log, json, code…) → fast viewer by default.
    //    An editor (e.g. Documents) stays reachable through "Open with". The
    //    explicit per-file preference (step 1) already has absolute priority.
    if (isTextFile(file)) { setTextFile(file); return }
    // 4. Associated application (kubuno .kb*** files and claimed formats) via FileTypeRegistry
    const opener = FileTypeRegistry.openersFor(file)[0]
    if (opener?.open) { opener.open(file, routerNavigate); return }
    // 5. Fallback: download
    window.open(filesApi.downloadUrl(file.id), '_blank')
  }, [openAudio, openVideoFile, routerNavigate])

  // Opens a file directly in its NATIVE preview (skipping the « open with »
  // preference). Used by the previewer's ←/→ navigation so it can move to the
  // next/previous previewable file of any type, handing off to the right viewer.
  const openPreview = useCallback((file: FileItem) => {
    void api.post(`/drive/${file.id}/view`).catch(() => {})
    const isImg  = file.mime_type.startsWith('image/')
    const isVid  = file.mime_type.startsWith('video/')
    const isAud  = file.mime_type.startsWith('audio/')
    const isPdf  = file.mime_type === 'application/pdf'
    const is3d   = is3dFile(file)
    const isFont = isFontFile(file)
    const isArch = isArchiveFile(file)
    const isTxt  = !isImg && !isVid && !isAud && !isPdf && !is3d && !isFont && !isArch && isTextFile(file)
    // Exactly one visual viewer is active at a time; clear the others.
    setLightboxFile(isImg  ? file : null)
    setModel3dFile (is3d   ? file : null)
    setFontFile    (isFont ? file : null)
    setPdfFile     (isPdf  ? file : null)
    setArchiveFile (isArch ? file : null)
    setTextFile    (isTxt  ? file : null)
    if (isVid) openVideoFile(file)
    if (isAud) openAudio(file)
  }, [openAudio, openVideoFile])

  return {
    lightboxFile, setLightboxFile,
    model3dFile, setModel3dFile,
    fontFile, setFontFile,
    pdfFile, setPdfFile,
    archiveFile, setArchiveFile,
    textFile, setTextFile,
    videoFile, closeVideoFile, videoRestorePos, videoClearPos,
    playingFileIds,
    openFile, openPreview,
  }
}
