import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { Router, type Navigator as RouterNavigator, type To } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  filesApi, useFilesDialogStore, FilesTextViewer, MoveModal, RenameModal, ShareModal,
  type FileItem,
} from '@kubuno/drive'
// `navigate` is aliased: `ExternalPreviewHost` has a local `navigate` of its own
// (moving between the previewed files), and shadowing would be confusing.
import { i18n, FileTypeRegistry, SlotRegistry, useModulesStore, navigate as shellNavigate } from '@kubuno/sdk'
import { AppWindow } from 'lucide-react'
import type { MenuItem } from '@ui'
import {
  canPreview, fetchFileBlob, fileSourceUrl, isExternalFile, makeExternalFile, previewKind,
  type ExternalSource,
} from './externalPreview'
import { ExternalPreviewContext, type SaveToDriveState } from './previewActions'
import { TagDialog, type TagDialogTarget } from './TagUI'

/**
 * `drive.openPreview` — the viewer other modules call (mail attachments, chat
 * files…). It opens the SAME viewers as Drive itself: each source is wrapped in
 * a synthetic FileItem (see `externalPreview`) and handed to the real overlays.
 *
 * A caller may hand over a WHOLE list (all the attachments of one e-mail) plus
 * the index to start on: the list feeds `FilePreviewShell.files` untouched, so
 * its « 3 / 15 ‹ › » counter and its ←/→ navigation work exactly as in Drive,
 * viewer switching included (PDF → image → …).
 *
 * The overlay is mounted in a React root of its own, appended to <body>, so a
 * caller can open it without Drive being on screen. That root carries the
 * providers the viewers expect — react-query (the shell and the PDF viewer use
 * it), i18n, and a minimal router whose navigations are forwarded to the host.
 */

// Lazily loaded so the module entry stays small: pdf.js, three.js and the
// image/shell chrome only land in the browser when a preview actually opens.
const FilePreviewOverlay  = lazy(() => import('./FilePreviewOverlay'))
const ImagePreviewOverlay = lazy(() => import('./ImagePreviewOverlay'))
const Files3DViewer       = lazy(() => import('./Files3DViewer'))
const FilesFontViewer     = lazy(() => import('./FilesFontViewer'))
const FilesVideoPlayer    = lazy(() => import('./drive-app/FilesVideoPlayer'))
const ExternalAudioPlayer = lazy(() => import('./FilesFloatingAudioPlayer').then(m => ({ default: m.ExternalAudioPlayer })))

let root: Root | null = null
let host: HTMLDivElement | null = null

function unmount() {
  // Deferred: React 19 warns when a root is unmounted while it is rendering
  // (the close handler runs inside an event dispatched from the tree).
  const r = root, h = host
  root = null
  host = null
  queueMicrotask(() => { r?.unmount(); h?.remove() })
}

// ── Host navigation ──────────────────────────────────────────────────────────
// Opening a file in another app (« Ouvrir avec ») leaves the previewer for a
// route of the host application: the previewer closes first, then the core's
// `navigate` moves the host router (real router navigation when it is mounted).

function hostNavigate(path: string, replace = false) {
  unmount()
  shellNavigate(path, { replace })
}

const hrefOf = (to: To) =>
  typeof to === 'string' ? to : `${to.pathname ?? ''}${to.search ?? ''}${to.hash ?? ''}`

/** Just enough of a `Navigator` for `useNavigate()` to work in this root: the
 *  « open with » contributors of other modules use it to reach their editor. */
const navigatorShim: RouterNavigator = {
  createHref: hrefOf,
  go:      (delta: number) => window.history.go(delta),
  push:    (to: To) => hostNavigate(hrefOf(to)),
  replace: (to: To) => hostNavigate(hrefOf(to), true),
}

// ── Viewer selection ─────────────────────────────────────────────────────────

interface VideoOverrideProps {
  file:        FileItem
  onClose:     () => void
  srcOverride?: string
}

interface ViewerProps {
  file:          FileItem
  files:         FileItem[]
  onClose:       () => void
  onNavigate:    (f: FileItem) => void
  onRename:      (f: FileItem) => void
  onMove:        (f: FileItem) => void
  onShare:       (f: FileItem) => void
  onEditTags:    (f: FileItem) => void
  openWithItems: (f: FileItem) => MenuItem[]
}

/** Picks the viewer matching the current file's type and feeds it the whole
 *  list, so the shell's file navigation spans every source of the request. */
function ExternalPreview(props: ViewerProps) {
  const { file, onClose } = props
  const kind = previewKind(file.name, file.mime_type)

  const activeModules = useModulesStore(s => s.activeModules)
  const activeIds     = useMemo(() => new Set(activeModules.map(m => m.module_id)), [activeModules])
  // Same override as the Drive app: the media module takes over video playback
  // when it is installed (it accepts an explicit source URL).
  const VideoOverride = useMemo(
    () => SlotRegistry.getActiveOverride<VideoOverrideProps>('files-video-player', activeIds),
    [activeIds],
  )

  switch (kind) {
    case 'pdf':
      return <FilePreviewOverlay {...props} />
    case 'image':
      return <ImagePreviewOverlay {...props} />
    case 'model3d':
      return <Files3DViewer file={file} onClose={onClose} />
    case 'font':
      return <FilesFontViewer file={file} onClose={onClose} />
    case 'video':
      return VideoOverride
        ? <VideoOverride file={file} onClose={onClose} srcOverride={fileSourceUrl(file)} />
        : <FilesVideoPlayer file={file} onClose={onClose} />
    case 'audio':
      return <ExternalAudioPlayer file={file} onClose={onClose} />
    case 'text':
      return <FilesTextViewer name={file.name} load={() => fetchFileBlob(file)} onClose={onClose} />
    default:
      return null
  }
}

// ── The host: file list, current index, « Enregistrer dans Drive » ───────────

interface HostProps {
  initialFiles: FileItem[]
  initialIndex: number
  onClose:      () => void
}

function ExternalPreviewHost({ initialFiles, initialIndex, onClose }: HostProps) {
  const { t } = useTranslation('drive')
  const [files, setFiles] = useState(initialFiles)
  const [index, setIndex] = useState(initialIndex)
  const [saveState, setSaveState] = useState<SaveToDriveState>('idle')
  const activeModules = useModulesStore(s => s.activeModules)
  const activeIds     = useMemo(() => new Set(activeModules.map(m => m.module_id)), [activeModules])

  // Drive dialogs for a file that HAS been imported: it is a real Drive file
  // now, so rename / move / share / labels must work like anywhere else.
  const [renameTarget, setRenameTarget] = useState<FileItem | null>(null)
  const [moveTarget,   setMoveTarget]   = useState<FileItem | null>(null)
  const [shareTarget,  setShareTarget]  = useState<FileItem | null>(null)
  const [tagTarget,    setTagTarget]    = useState<TagDialogTarget | null>(null)

  const current = files[index]

  const navigate = useCallback((f: FileItem) => {
    const at = files.findIndex(x => x.id === f.id)
    if (at >= 0 && at !== index) { setIndex(at); setSaveState('idle') }
  }, [files, index])

  // « Ouvrir avec » — empty for an external source (nothing to open by id), the
  // regular Drive entries once the file has been imported.
  const openWithItems = useCallback((f: FileItem): MenuItem[] => {
    if (isExternalFile(f)) return []
    const out: MenuItem[] = FileTypeRegistry.openersFor(f).map(decl => ({
      type: 'action' as const,
      label: decl.label,
      icon: <AppWindow size={14} />,
      onClick: () => { decl.open?.(f, hostNavigate); filesApi.setOpenWith(f.id, decl.moduleId).catch(() => {}) },
    }))
    const contributors = SlotRegistry.getSlot('files-open-with') as Array<{ moduleId: string; Component: ComponentType; match?: (f: FileItem) => boolean }>
    contributors
      .filter(e => activeIds.has(e.moduleId))
      .filter(e => !e.match || e.match(f))
      .forEach(e => { const C = e.Component; out.push({ type: 'custom', render: () => <C key={e.moduleId} /> }) })
    return out
  }, [activeIds])

  // ── « Enregistrer dans Drive » ─────────────────────────────────────────────
  // Downloads the bytes, asks for a destination folder, uploads — then SWAPS
  // the synthetic file for the real one: `isExternalFile` turns false and the
  // whole Drive chrome (open with, share, rename, details…) comes back on its
  // own, with no special case anywhere in the viewers.
  const saveToDrive = useCallback(() => {
    const source = current
    if (!source || !isExternalFile(source) || saveState === 'saving') return
    setSaveState('saving')
    void (async () => {
      try {
        const blob = await fetchFileBlob(source)
        let folderId: string | null = null
        try {
          const picked = await useFilesDialogStore.getState().pickFolder({
            title: t('preview.save_to_drive', { defaultValue: 'Enregistrer dans Drive' }),
          })
          // Explicit cancel aborts; a picker that never answers (Drive dialogs
          // not mounted) falls back to the root folder.
          if (picked === null) { setSaveState('idle'); return }
          // Remote mounts carry no folder id — `uploadFile` only writes to the
          // user's own Drive, so such a pick lands at the root.
          folderId = picked.id
        } catch { folderId = null }

        const upload = new File([blob], source.name, { type: source.mime_type || blob.type })
        const { file: saved } = await filesApi.uploadFile(upload, folderId)
        setFiles(list => list.map((it, i) => (i === index ? saved : it)))
        setSaveState('saved')
        window.setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 4000)
      } catch {
        setSaveState('error')
        window.setTimeout(() => setSaveState(s => (s === 'error' ? 'idle' : s)), 5000)
      }
    })()
  }, [current, index, saveState, t])

  const actions = useMemo(() => ({ saveToDrive, saveState }), [saveToDrive, saveState])

  // A source removed from the list (never happens today) or an empty request.
  useEffect(() => { if (!current) onClose() }, [current, onClose])
  if (!current) return null

  return (
    <ExternalPreviewContext.Provider value={actions}>
      <ExternalPreview
        file={current}
        files={files}
        onClose={onClose}
        onNavigate={navigate}
        onRename={setRenameTarget}
        onMove={setMoveTarget}
        onShare={setShareTarget}
        onEditTags={(f) => setTagTarget({ kind: 'file', id: f.id, name: f.name })}
        openWithItems={openWithItems}
      />
      {/* Drive dialogs — only ever reachable for an imported (real) file. */}
      <RenameModal target={renameTarget ? { type: 'file', item: renameTarget } : null} onClose={() => setRenameTarget(null)} />
      <MoveModal   target={moveTarget   ? { type: 'file', item: moveTarget   } : null} onClose={() => setMoveTarget(null)} />
      <ShareModal  target={shareTarget  ? { type: 'file', item: shareTarget  } : null} onClose={() => setShareTarget(null)} />
      {tagTarget && <TagDialog target={tagTarget} onClose={() => setTagTarget(null)} />}
    </ExternalPreviewContext.Provider>
  )
}

// ── Public API ───────────────────────────────────────────────────────────────

/** A whole set of sources plus the one to open first. */
export interface ExternalSourceList {
  items:  ExternalSource[]
  /** Index inside `items` of the source to show first (default 0). */
  index?: number
}

type PreviewRequest = ExternalSource | ExternalSourceList

/**
 * Opens the previewer on one source, or on a list with a starting index.
 * Returns false — leaving the caller free to fall back to a download — when
 * the requested source is not one Drive can render.
 */
export function openPreview(request: PreviewRequest): boolean {
  if (!request) return false
  const list  = 'items' in request ? request : { items: [request], index: 0 }
  const items = Array.isArray(list.items) ? list.items.filter(s => s?.url) : []
  if (items.length === 0) return false
  const wanted = Math.min(Math.max(list.index ?? 0, 0), items.length - 1)

  // Only renderable sources make it into the navigation list — same rule as
  // Drive, whose ←/→ walks the previewable files of the current view.
  const files: FileItem[] = []
  let start = -1
  items.forEach((source, i) => {
    if (!previewKind(source.name || '', source.mime)) return
    if (i === wanted) start = files.length
    files.push(makeExternalFile(source))
  })
  // The clicked source itself is not renderable: let the caller handle it.
  if (start < 0) return false

  unmount()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  // A client of its own: this root lives outside the host's provider tree.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root.render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <Router location={window.location.pathname + window.location.search} navigator={navigatorShim}>
          <Suspense fallback={null}>
            <ExternalPreviewHost initialFiles={files} initialIndex={start} onClose={unmount} />
          </Suspense>
        </Router>
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return true
}

export { canPreview }
export type { ExternalSource }
