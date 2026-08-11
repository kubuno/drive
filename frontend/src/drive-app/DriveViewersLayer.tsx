import { useMemo } from 'react'
import { filesApi, FilesTextViewer, type FileItem } from '@kubuno/drive'
import { SlotRegistry, useModulesStore } from '@kubuno/sdk'
import type { MenuItem } from '@ui'
import FilePreviewOverlay from '../FilePreviewOverlay'
import Files3DViewer from '../Files3DViewer'
import FilesFontViewer from '../FilesFontViewer'
import ImagePreviewOverlay from '../ImagePreviewOverlay'
import FilesVideoPlayer from './FilesVideoPlayer'
import type { DriveDialogs } from './useDriveDialogs'
import type { DriveViewers } from './useDriveViewers'

interface Props {
  viewers: DriveViewers
  dialogs: DriveDialogs
  /** Previewable files the previewer's ←/→ navigation cycles through. */
  previewNavFiles: FileItem[]
  openWithItemsFor: (file: FileItem) => MenuItem[]
}

/** Full-screen / floating viewers layered above the DriveApp views. */
export default function DriveViewersLayer({ viewers, dialogs, previewNavFiles, openWithItemsFor }: Props) {
  const activeModules = useModulesStore(s => s.activeModules)
  const activeIds     = useMemo(() => new Set(activeModules.map(m => m.module_id)), [activeModules])

  // (The photos module's « files-image-viewer » override is no longer used here:
  // image previews go through ImagePreviewOverlay, built on FilePreviewShell.)
  // Use the media module video player (floating window) when that module is active
  const VideoPlayer = useMemo(
    () => SlotRegistry.getActiveOverride<{ file: FileItem; onClose: () => void; initialPosition?: number; onInitialPositionConsumed?: () => void; onTimeUpdate?: (t: number) => void }>('files-video-player', activeIds),
    [activeIds],
  )

  const {
    lightboxFile, setLightboxFile, model3dFile, setModel3dFile, fontFile, setFontFile,
    pdfFile, setPdfFile, textFile, setTextFile,
    videoFile, closeVideoFile, videoRestorePos, videoClearPos, openPreview,
  } = viewers

  return (
    <>
      {/* Image preview (FilePreviewShell) */}
      {lightboxFile && (
        <ImagePreviewOverlay
          file={lightboxFile}
          files={previewNavFiles}
          onClose={() => setLightboxFile(null)}
          onNavigate={openPreview}
          onRename={(f) => dialogs.setRenameTarget({ type: 'file', item: f })}
          onMove={(f) => dialogs.setMoveTarget({ type: 'file', item: f })}
          onShare={(f) => dialogs.setAdvShareTarget({ kind: 'file', id: f.id, name: f.name })}
          onEditTags={(f) => dialogs.setTagDialogTarget({ kind: 'file', id: f.id, name: f.name })}
          openWithItems={openWithItemsFor}
          onEditImage={(f) => dialogs.setImageEditFile(f)}
        />
      )}

      {/* Video player — replaced by the media module when active */}
      {videoFile && (
        VideoPlayer
          ? <VideoPlayer
              file={videoFile}
              onClose={closeVideoFile}
              initialPosition={videoRestorePos}
              onInitialPositionConsumed={videoClearPos}
              onTimeUpdate={(t) => { (window as Window & { __filesVideoPos?: number }).__filesVideoPos = t }}
            />
          : <FilesVideoPlayer file={videoFile} onClose={closeVideoFile} />
      )}

      {/* 3D viewer */}
      {model3dFile && (
        <Files3DViewer file={model3dFile} onClose={() => setModel3dFile(null)} />
      )}

      {/* Font viewer */}
      {fontFile && (
        <FilesFontViewer file={fontFile} onClose={() => setFontFile(null)} />
      )}

      {/* Text viewer */}
      {textFile && (
        <FilesTextViewer
          name={textFile.name}
          load={() => filesApi.downloadBlob(textFile.id)}
          onClose={() => setTextFile(null)}
        />
      )}

      {/* PDF viewer (Drive-style full-screen preview) */}
      {pdfFile && (
        <FilePreviewOverlay
          file={pdfFile}
          files={previewNavFiles}
          onClose={() => setPdfFile(null)}
          onNavigate={openPreview}
          onRename={(f) => dialogs.setRenameTarget({ type: 'file', item: f })}
          onMove={(f) => dialogs.setMoveTarget({ type: 'file', item: f })}
          onShare={(f) => dialogs.setAdvShareTarget({ kind: 'file', id: f.id, name: f.name })}
          onEditTags={(f) => dialogs.setTagDialogTarget({ kind: 'file', id: f.id, name: f.name })}
          openWithItems={openWithItemsFor}
        />
      )}
    </>
  )
}
