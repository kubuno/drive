// Generic fullscreen file-preview shell (Drive-style dark chrome). It owns
// everything that is NOT tied to a specific viewer: header (close, type chip,
// name, move), the menubar (Fichier / Afficher / … / Outils / Aide), the
// header-right controls (Ouvrir avec, Partager + share slot, prev/next file),
// the left gutter (rail-mode buttons + bottom toggle + size hint), the dark
// Details panel, the notification and keyboard-shortcuts dialogs and the base
// keyboard bindings. Viewers (PDF pages, images, video…) plug their own
// features in through `PreviewShellExtensions`: rail content, toolbar pill,
// extra menus, print, shortcuts sections, key handling and overlays.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { filesApi, formatSize, FilesOpenWithContext, type FileItem } from '@kubuno/drive'
import { api, useAuthStore, SlotRegistry, useModulesStore } from '@kubuno/sdk'
import { MenuDropdown, type MenuItem } from '@ui'
import {
  X, Download, Printer, ChevronLeft, ChevronRight, ChevronDown, FileText,
  Share2, FolderInput, Pencil, Star, Tags, Info, PanelLeft, AppWindow, Link2,
  List, ExternalLink, Bell, Search,
} from 'lucide-react'

// ── Public types ─────────────────────────────────────────────────────────────

export interface ShortcutSection {
  title: string
  rows:  Array<{ label: string; keys: string[] }>
}

export interface PreviewShellApi {
  /** Close the previewer unless a shell-level transient UI (menu) is open.
   *  Viewers call this from their backdrop clicks after checking their own
   *  transient UIs. */
  requestClose: () => void
}

export interface PreviewShellExtensions {
  /** Contents of the « Afficher » menu; the menu is hidden when empty. */
  viewMenu?: MenuItem[]
  /** Extra menubar menus, inserted between Afficher and Outils. */
  menus?: Array<{ id: string; label: string; items: MenuItem[] }>
  /** Items prepended to « Outils » (before « Gérer les notifications »). */
  toolsMenu?: MenuItem[]
  /** Content of the centered toolbar pill (viewer controls). */
  toolbar?: React.ReactNode
  /** Extra node inside the (relative) toolbar row — e.g. a find bar. */
  toolbarOverlay?: React.ReactNode
  /** Buttons stacked at the top of the left gutter (rail modes). */
  railButtons?: React.ReactNode
  /** Left rail content; omit to collapse the rail. */
  rail?: React.ReactNode
  /** Effective rail width (0 when hidden) — keeps the toolbar centered. */
  railWidth?: number
  /** Bottom-left rail toggle; the button is hidden without it. */
  onToggleRail?: () => void
  railToggled?: boolean
  /** Print implementation; enables « Imprimer » and Ctrl+P. */
  onPrint?: () => void | Promise<void>
  /** Sections appended to the shortcuts dialog. */
  shortcutSections?: ShortcutSection[]
  /** Viewer key handler — runs FIRST; return true when the key is consumed. */
  onKey?: (e: KeyboardEvent) => boolean
  /** Called after the shell swallowed a right-click on the overlay. */
  onContextMenu?: (e: React.MouseEvent) => void
  /** Viewer-owned absolute overlays (banners, cards, local dropdowns). */
  overlays?: React.ReactNode
}

export interface PreviewShellProps {
  file:          FileItem
  /** All previewable files of the current view, in order (←/→ navigation). */
  files:         FileItem[]
  onClose:       () => void
  /** Opens another previewable file in its own viewer. */
  onNavigate:    (f: FileItem) => void
  onRename:      (f: FileItem) => void
  onMove:        (f: FileItem) => void
  onShare:       (f: FileItem) => void
  onEditTags:    (f: FileItem) => void
  /** Builds the « Ouvrir avec » entries for a file (apps + contributors). */
  openWithItems: (f: FileItem) => MenuItem[]
  ext?:          PreviewShellExtensions
  /** The viewer content zone (fills the space between rail and details). */
  children:      (shell: PreviewShellApi) => React.ReactNode
}

// ── Hover-visible custom scrollbars (shared with viewers) ────────────────────
// Chrome's overlay scrollbars ignore ::-webkit-scrollbar styling, so scrollable
// zones hide their native bars and paint their own thumbs, faded in while the
// wrapping `.pdf-scroll-wrap` is hovered. `deps` re-syncs geometry.

export function ScrollThumbs({ target, deps, alwaysTrack = false }: {
  target: React.RefObject<HTMLDivElement | null>
  deps: unknown[]
  /** Show the full-height track line on hover even without overflow (rail). */
  alwaysTrack?: boolean
}) {
  const [v, setV] = useState<{ top: number; height: number } | null>(null)
  const [h, setH] = useState<{ left: number; width: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const update = useCallback(() => {
    const el = target.current
    if (!el) { setV(null); setH(null); return }
    if (el.scrollHeight > el.clientHeight + 1) {
      const th = Math.max(30, (el.clientHeight * el.clientHeight) / el.scrollHeight)
      setV({ top: (el.clientHeight - th) * (el.scrollTop / (el.scrollHeight - el.clientHeight)), height: th })
    } else setV(null)
    if (el.scrollWidth > el.clientWidth + 1) {
      const tw = Math.max(30, (el.clientWidth * el.clientWidth) / el.scrollWidth)
      setH({ left: (el.clientWidth - tw) * (el.scrollLeft / (el.scrollWidth - el.clientWidth)), width: tw })
    } else setH(null)
  }, [target])

  useEffect(() => {
    const el = target.current
    if (!el) return
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => { el.removeEventListener('scroll', update); ro.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, update, ...deps])

  const [drag, setDrag] = useState<{ axis: 'v' | 'h'; start: number; origin: number } | null>(null)
  const onDown = (axis: 'v' | 'h') => (e: React.PointerEvent) => {
    const el = target.current
    if (!el) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ axis, start: axis === 'v' ? e.clientY : e.clientX, origin: axis === 'v' ? el.scrollTop : el.scrollLeft })
    setDragging(true)
  }
  const onMove = (e: React.PointerEvent) => {
    const el = target.current
    if (!el || !drag) return
    if (drag.axis === 'v') {
      const geo = v; if (!geo) return
      const track = el.clientHeight - geo.height
      if (track > 0) el.scrollTop = drag.origin + (e.clientY - drag.start) * (el.scrollHeight - el.clientHeight) / track
    } else {
      const geo = h; if (!geo) return
      const track = el.clientWidth - geo.width
      if (track > 0) el.scrollLeft = drag.origin + (e.clientX - drag.start) * (el.scrollWidth - el.clientWidth) / track
    }
  }
  const onUp = () => { setDrag(null); setDragging(false) }

  return (
    <>
      {/* Track line, shown on hover (like Drive), even without overflow. */}
      {(v || alwaysTrack) && <div className="pdf-scroll-track v" />}
      {v && (
        <div
          className={`pdf-scroll-thumb v${dragging ? ' dragging' : ''}`}
          style={{ top: v.top, height: v.height }}
          onPointerDown={onDown('v')} onPointerMove={onMove} onPointerUp={onUp}
        />
      )}
      {h && <div className="pdf-scroll-track h" />}
      {h && (
        <div
          className={`pdf-scroll-thumb h${dragging ? ' dragging' : ''}`}
          style={{ left: h.left, width: h.width }}
          onPointerDown={onDown('h')} onPointerMove={onMove} onPointerUp={onUp}
        />
      )}
    </>
  )
}

// ── File-type chip ───────────────────────────────────────────────────────────

export function FileTypeChip({ mime }: { mime: string }) {
  if (mime === 'application/pdf') {
    return (
      <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-red-500 text-white text-[10px] font-semibold tracking-wide shrink-0 select-none">
        PDF
      </span>
    )
  }
  return (
    <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/10 text-white shrink-0">
      <FileText size={16} />
    </span>
  )
}

// ── Details panel (dark, integrated — Drive-style) ───────────────────────────

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3.5">
      <p className="text-white/50 text-xs mb-0.5">{label}</p>
      <div className="text-white/90 text-xs">{children}</div>
    </div>
  )
}

function PreviewDetailsPanel({ file, onClose, onManageAccess }: {
  file:           FileItem
  onClose:        () => void
  onManageAccess: () => void
}) {
  const { t } = useTranslation('drive')
  const qc = useQueryClient()
  const me = useAuthStore(s => s.user)

  const { data: sharesData } = useQuery({
    queryKey: ['drive-shares'],
    queryFn:  () => filesApi.listShares(),
  })
  const fileShares = useMemo(
    () => (sharesData?.shares ?? []).filter(s => s.file_id === file.id && !s.revoked_at),
    [sharesData, file.id],
  )
  const recipients = fileShares.filter(s => s.recipient_id).length
  const hasLink    = fileShares.some(s => s.token)

  const { data: accessData } = useQuery({
    queryKey: ['drive-access', file.id],
    queryFn:  () => api.get<{ access: { last_viewed_at: string | null } | null }>(`/drive/${file.id}/access`).then(r => r.data.access),
  })

  const { data: folderData } = useQuery({
    queryKey: ['folder-meta', file.folder_id],
    queryFn:  () => filesApi.getFolder(file.folder_id!),
    enabled:  !!file.folder_id,
  })

  const [desc, setDesc] = useState('')
  useEffect(() => { setDesc((file.metadata?.description as string) ?? '') }, [file.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const saveDesc = useCallback(() => {
    const initial = (file.metadata?.description as string) ?? ''
    if (desc.trim() === initial.trim()) return
    void api.patch(`/drive/${file.id}/user-metadata`, { description: desc.trim() })
      .then(() => qc.invalidateQueries({ queryKey: ['files'] }))
      .catch(() => {})
  }, [desc, file, qc])

  const fmtDate = (s: string | null | undefined) => {
    if (!s) return null
    const d = new Date(s)
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  }
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toUpperCase() : file.mime_type
  const isMine = !me || file.owner_id === me.id
  const initial = (me?.display_name ?? me?.email ?? '?').trim().charAt(0).toUpperCase()

  const accessLabel = recipients > 0
    ? t('preview.details_shared_with', { defaultValue: 'Partagé avec {{n}} personne(s)', n: recipients })
    : hasLink
      ? t('preview.details_link_share', { defaultValue: 'Partagé par lien' })
      : t('preview.details_private', { defaultValue: 'Privé' })

  return (
    <div className="w-[320px] shrink-0 border-l border-white/10 overflow-y-auto select-text px-5 py-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-white text-[15px]">{t('preview.details', { defaultValue: 'Détails' })}</h2>
        <button onClick={onClose} className="p-1.5 rounded-full text-white/60 hover:bg-white/10 hover:text-white transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Qui a accès */}
      <h3 className="text-white/90 text-xs font-medium mb-2">{t('preview.details_who', { defaultValue: 'Qui a accès' })}</h3>
      <div className="flex items-center gap-2 mb-1.5">
        {me?.avatar_url
          ? <img src={me.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
          : <span className="w-8 h-8 rounded-full bg-blue-500/30 text-blue-200 text-xs flex items-center justify-center">{initial}</span>}
      </div>
      <p className="text-white/50 text-xs mb-3">{accessLabel}</p>
      <button
        onClick={onManageAccess}
        className="px-3.5 py-1.5 text-xs text-white/90 rounded-full border border-white/25 hover:bg-white/10 transition-colors"
      >
        {t('preview.details_manage', { defaultValue: 'Gérer l’accès' })}
      </button>

      <div className="h-px bg-white/10 my-5" />

      {/* Détails du fichier */}
      <h3 className="text-white/90 text-xs font-medium mb-3">{t('preview.details_file', { defaultValue: 'Détails du fichier' })}</h3>
      <DetailRow label={t('preview.details_type', { defaultValue: 'Type' })}>{ext}</DetailRow>
      <DetailRow label={t('preview.details_size', { defaultValue: 'Taille' })}>{formatSize(file.size_bytes)}</DetailRow>
      <DetailRow label={t('preview.details_storage', { defaultValue: 'Espace de stockage utilisé' })}>{formatSize(file.size_bytes)}</DetailRow>
      <DetailRow label={t('preview.details_location', { defaultValue: 'Emplacement' })}>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 text-white/90">
          <FolderInput size={13} className="opacity-70" />
          {folderData?.folder?.name ?? t('nav.my_files', { defaultValue: 'Mon Drive' })}
        </span>
      </DetailRow>
      <DetailRow label={t('preview.details_owner', { defaultValue: 'Propriétaire' })}>
        {isMine ? t('preview.details_me', { defaultValue: 'moi' }) : '—'}
      </DetailRow>
      <DetailRow label={t('preview.details_modified', { defaultValue: 'Date de modification' })}>{fmtDate(file.updated_at)}</DetailRow>
      {accessData?.last_viewed_at && (
        <DetailRow label={t('preview.details_opened', { defaultValue: 'Ouvert' })}>{fmtDate(accessData.last_viewed_at)}</DetailRow>
      )}
      <DetailRow label={t('preview.details_created', { defaultValue: 'Date de création' })}>{fmtDate(file.created_at)}</DetailRow>

      {/* Description */}
      <p className="text-white/50 text-xs mb-1 mt-4">{t('preview.details_desc', { defaultValue: 'Description' })}</p>
      <textarea
        value={desc}
        onChange={e => setDesc(e.target.value)}
        onBlur={saveDesc}
        placeholder={t('preview.details_desc_ph', { defaultValue: 'Ajouter une description' })}
        className="w-full h-16 resize-none rounded-lg bg-transparent border border-white/25 px-3 py-2 text-xs text-white/90 placeholder-white/40 outline-none focus:border-white/60 transition-colors"
      />
    </div>
  )
}

// ── Keyboard shortcuts dialog (dark, searchable, Drive-style) ────────────────

function KeyChip({ k }: { k: string }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[26px] h-6 px-1.5 rounded-md border border-white/40 text-white/90 text-xs font-mono">
      {k}
    </span>
  )
}

function ShortcutsDialog({ sections, onClose }: { sections: ShortcutSection[]; onClose: () => void }) {
  const { t } = useTranslation('drive')
  const [q, setQ] = useState('')

  const needle = q.trim().toLowerCase()
  const filtered = sections
    .map(s => ({ ...s, rows: needle ? s.rows.filter(r => r.label.toLowerCase().includes(needle)) : s.rows }))
    .filter(s => s.rows.length > 0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-[34rem] max-w-[94vw] max-h-[86vh] flex flex-col rounded-2xl bg-neutral-800 border border-white/10 shadow-2xl p-6 select-text">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white text-xl">{t('preview.shortcuts', { defaultValue: 'Raccourcis clavier' })}</h2>
          <button onClick={onClose} className="p-1.5 rounded-full text-white/70 hover:bg-white/10 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="flex items-center gap-2 bg-neutral-900 rounded-full px-4 py-2.5 mb-4">
          <Search size={16} className="text-white/50 shrink-0" />
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={t('common.search_ph', { defaultValue: 'Rechercher…' })}
            className="flex-1 bg-transparent text-white text-sm placeholder-white/40 outline-none"
          />
        </div>
        <div className="flex-1 overflow-y-auto pr-1 -mr-1">
          {filtered.length === 0 && (
            <p className="text-white/50 text-xs py-6 text-center">{t('common.no_results', { defaultValue: 'Aucun résultat' })}</p>
          )}
          {filtered.map(s => (
            <div key={s.title} className="mb-2">
              <h3 className="text-white/60 text-sm font-medium py-2">{s.title}</h3>
              {s.rows.map(r => (
                <div key={r.label} className="flex items-center justify-between gap-4 py-2.5 border-b border-white/10 last:border-b-0">
                  <span className="text-white/90 text-xs">{r.label}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    {r.keys.map(k => <KeyChip key={k} k={k} />)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Notification settings dialog (dark, Drive-style) ─────────────────────────

function NotificationDialog({ mode, onCancel, onSave }: {
  mode:     'all' | 'mine' | 'none'
  onCancel: () => void
  onSave:   (m: 'all' | 'mine' | 'none') => void
}) {
  const { t } = useTranslation('drive')
  const [sel, setSel] = useState(mode)
  const OPTIONS: Array<{ id: 'all' | 'mine' | 'none'; label: string }> = [
    { id: 'all',  label: t('preview.notif_all',  { defaultValue: 'Tous les commentaires' }) },
    { id: 'mine', label: t('preview.notif_mine', { defaultValue: 'Commentaires pour vous' }) },
    { id: 'none', label: t('preview.notif_none', { defaultValue: 'Aucune' }) },
  ]
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative w-[26rem] max-w-[92vw] rounded-2xl bg-neutral-800 border border-white/10 shadow-2xl p-6 select-text">
        <h2 className="text-white text-xl mb-4">{t('preview.notif_title', { defaultValue: 'Paramètres de notification' })}</h2>
        <p className="text-white/80 text-xs mb-3">{t('preview.notif_subtitle', { defaultValue: 'Envoyer des notifications pour :' })}</p>
        <div className="space-y-2 mb-6">
          {OPTIONS.map(o => (
            <label key={o.id} className="flex items-center gap-3 text-white/90 text-xs cursor-pointer py-0.5">
              <span
                className={`w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${sel === o.id ? 'border-blue-400' : 'border-white/50'}`}
                onClick={() => setSel(o.id)}
              >
                {sel === o.id && <span className="w-2 h-2 rounded-full bg-blue-400" />}
              </span>
              <span onClick={() => setSel(o.id)}>{o.label}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-1.5 text-xs text-blue-400 rounded-lg hover:bg-white/10 transition-colors">
            {t('common.cancel', { defaultValue: 'Annuler' })}
          </button>
          <button onClick={() => onSave(sel)} className="px-4 py-1.5 text-xs text-white rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors">
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

// ── The shell ────────────────────────────────────────────────────────────────

export default function FilePreviewShell({
  file, files, onClose, onNavigate, onRename, onMove, onShare, onEditTags,
  openWithItems, ext = {}, children,
}: PreviewShellProps) {
  const { t } = useTranslation('drive')
  const qc = useQueryClient()

  const current = file
  const list = useMemo(
    () => (files.some(f => f.id === file.id) ? files : [file]),
    [files, file],
  )
  const idx = list.findIndex(f => f.id === current.id)

  // ── Panels & dialogs ───────────────────────────────────────────────────────
  const [showDetails,      setShowDetails]      = useState(false)
  const [notifyDialogOpen, setNotifyDialogOpen] = useState(false)
  const [shortcutsOpen,    setShortcutsOpen]    = useState(false)
  const [notifyMode,       setNotifyMode]       = useState<'all' | 'mine' | 'none'>('all')
  useEffect(() => {
    const saved = localStorage.getItem(`drive:pdf-notify:${current.id}`)
    setNotifyMode(saved === 'mine' || saved === 'none' ? saved : 'all')
  }, [current.id])

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    window.open(filesApi.downloadUrl(current.id), '_blank', 'noreferrer')
  }, [current.id])

  const handleStar = useCallback(() => {
    void filesApi.starFile(current.id)
      .then(() => qc.invalidateQueries({ queryKey: ['files'] }))
      .catch(() => {})
  }, [current.id, qc])

  // Public share link: reuse an existing tokenized share, else create one.
  const [linkCopied, setLinkCopied] = useState(false)
  const ensurePublicLink = useCallback(async (): Promise<string> => {
    const { shares } = await filesApi.listShares()
    let share = shares.find(s => s.file_id === current.id && s.token && !s.revoked_at)
    if (!share) share = (await filesApi.createShare({ file_id: current.id, can_download: true })).share
    return `${window.location.origin}/api/v1/drive/share/${share.token}`
  }, [current.id])

  const handleCopyLink = useCallback(async () => {
    try {
      const url = await ensurePublicLink()
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url)
      } else {
        const ta = document.createElement('textarea')
        ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0'
        document.body.appendChild(ta); ta.select()
        try { document.execCommand('copy') } finally { document.body.removeChild(ta) }
      }
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2500)
    } catch { /* stay silent, share dialog remains available */ }
  }, [ensurePublicLink])

  const prevFile = useCallback(() => { if (idx > 0) onNavigate(list[idx - 1]) }, [idx, list, onNavigate])
  const nextFile = useCallback(() => { if (idx < list.length - 1) onNavigate(list[idx + 1]) }, [idx, list, onNavigate])

  // ── Menus ──────────────────────────────────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState<{ id: string; top: number; left: number } | null>(null)
  const extMenus = ext.menus ?? []
  const menubarIds = useMemo(() => {
    const ids = ['file']
    if (ext.viewMenu?.length) ids.push('view')
    ids.push(...extMenus.map(m => m.id), 'tools', 'help')
    return ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ext.viewMenu, extMenus.map(m => m.id).join(',')])

  const openMenu = useCallback((id: string) => (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setMenuOpen(prev => (prev?.id === id ? null : { id, top: r.bottom + 4, left: id === 'sharemore' || id === 'openwith' ? Math.max(8, r.right - 220) : r.left }))
  }, [])
  const switchMenu = useCallback((id: string) => (e: React.MouseEvent<HTMLElement>) => {
    // Read the rect synchronously: the synthetic event is recycled before the
    // setState updater runs, so `e.currentTarget` would be null inside it.
    const r = e.currentTarget.getBoundingClientRect()
    setMenuOpen(prev => {
      if (!prev || !menubarIds.includes(prev.id) || prev.id === id) return prev
      return { id, top: r.bottom + 4, left: r.left }
    })
  }, [menubarIds])

  // « Open with » entries. Slot contributors style themselves for the LIGHT
  // context menus: the wrapper remaps + imposes the dark native item look.
  const openWith = useMemo(() => openWithItems(current).map(it =>
    it.type === 'custom'
      ? { ...it, render: (close: () => void) => <div className="pdf-dark-openwith">{it.render(close)}</div> }
      : it,
  ), [openWithItems, current])

  // Share extras: « Copier le lien » plus actions contributed by other modules
  // (slot files-share-actions — e.g. mail's « Envoyer ce fichier par e-mail »,
  // present only while the mail module is active).
  const activeModules = useModulesStore(s => s.activeModules)
  const shareMoreItems = useMemo<MenuItem[]>(() => {
    const activeIds = new Set(activeModules.map(m => m.module_id))
    const items: MenuItem[] = [
      {
        type: 'action', icon: <Link2 size={14} />, onClick: () => { void handleCopyLink() },
        label: linkCopied
          ? t('preview.link_copied', { defaultValue: 'Lien copié !' })
          : t('preview.copy_link',   { defaultValue: 'Copier le lien' }),
      },
    ]
    const contributors = SlotRegistry.getSlot('files-share-actions') as Array<{ moduleId: string; Component: React.ComponentType; match?: (f: FileItem) => boolean }>
    contributors
      .filter(e => activeIds.has(e.moduleId))
      .filter(e => !e.match || e.match(current))
      .forEach(e => {
        const C = e.Component
        items.push({
          type: 'custom',
          render: (close) => (
            <div className="pdf-dark-openwith" onClickCapture={() => setTimeout(close, 0)}>
              <C key={e.moduleId} />
            </div>
          ),
        })
      })
    return items
  }, [t, linkCopied, handleCopyLink, activeModules, current])

  const fileMenuItems = useMemo<MenuItem[]>(() => [
    {
      type: 'submenu', label: t('preview.open', { defaultValue: 'Ouvrir' }), icon: <AppWindow size={14} />,
      items: [
        {
          type: 'action', label: t('preview.open_new_tab', { defaultValue: 'Ouvrir dans un nouvel onglet' }),
          icon: <ExternalLink size={14} />,
          // `inline=1`: the backend serves Content-Disposition inline so the
          // browser DISPLAYS the file instead of saving it.
          onClick: () => window.open(`${filesApi.downloadUrl(current.id)}?inline=1`, '_blank', 'noreferrer'),
        },
        ...(openWith.length > 0 ? [{ type: 'separator' } as MenuItem, ...openWith] : []),
      ],
    },
    { type: 'separator' },
    {
      type: 'submenu', label: t('preview.share', { defaultValue: 'Partager' }), icon: <Share2 size={14} />,
      items: [
        { type: 'action', label: t('preview.share', { defaultValue: 'Partager' }), icon: <Share2 size={14} />, onClick: () => onShare(current) },
        ...shareMoreItems,
      ],
    },
    { type: 'action', label: t('common.download'), shortcut: 'Ctrl+D',           icon: <Download size={14} />,    onClick: handleDownload },
    { type: 'separator' },
    { type: 'action', label: t('common.rename'),                                 icon: <Pencil size={14} />,      onClick: () => onRename(current) },
    { type: 'action', label: t('ctx.move',     { defaultValue: 'Déplacer' }),    icon: <FolderInput size={14} />, onClick: () => onMove(current) },
    {
      type: 'action', icon: <Star size={14} />, onClick: handleStar,
      label: current.is_starred
        ? t('ctx.unstar', { defaultValue: 'Retirer des suivis' })
        : t('ctx.star',   { defaultValue: 'Ajouter aux suivis' }),
    },
    { type: 'action', label: t('preview.labels', { defaultValue: 'Étiquettes…' }), icon: <Tags size={14} />, onClick: () => onEditTags(current) },
    { type: 'separator' },
    { type: 'action', label: t('preview.details', { defaultValue: 'Détails' }), shortcut: 'D', icon: <Info size={14} />, onClick: () => setShowDetails(v => !v) },
    ...(ext.onPrint ? [
      { type: 'separator' } as MenuItem,
      { type: 'action', label: t('preview.print', { defaultValue: 'Imprimer' }), shortcut: 'Ctrl+P', icon: <Printer size={14} />, onClick: () => { void ext.onPrint!() } } as MenuItem,
    ] : []),
  ], [t, openWith, current, onShare, onRename, onMove, onEditTags, handleDownload, handleStar, shareMoreItems, ext.onPrint])

  const toolsMenuItems = useMemo<MenuItem[]>(() => [
    ...(ext.toolsMenu?.length ? [...ext.toolsMenu, { type: 'separator' } as MenuItem] : []),
    { type: 'action', label: t('preview.notifications_manage', { defaultValue: 'Gérer les notifications' }), icon: <Bell size={14} />, onClick: () => setNotifyDialogOpen(true) },
  ], [t, ext.toolsMenu])

  const helpMenuItems = useMemo<MenuItem[]>(() => [
    {
      type: 'action', label: t('preview.shortcuts', { defaultValue: 'Raccourcis clavier' }), shortcut: 'Ctrl+/',
      icon: <List size={14} />, onClick: () => setShortcutsOpen(true),
    },
  ], [t])

  const activeMenuItems: MenuItem[] =
    menuOpen?.id === 'file'      ? fileMenuItems
    : menuOpen?.id === 'view'    ? (ext.viewMenu ?? [])
    : menuOpen?.id === 'tools'   ? toolsMenuItems
    : menuOpen?.id === 'help'    ? helpMenuItems
    : menuOpen?.id === 'openwith' ? openWith
    : menuOpen?.id === 'sharemore' ? shareMoreItems
    : extMenus.find(m => m.id === menuOpen?.id)?.items ?? []

  // ── Shortcuts dialog sections (base + viewer) ──────────────────────────────
  const shortcutSections = useMemo<ShortcutSection[]>(() => [
    {
      title: t('preview.sc_nav', { defaultValue: 'Navigation' }),
      rows: [
        { label: t('preview.sc_close',  { defaultValue: 'Fermer le lecteur' }), keys: ['Échap'] },
        { label: t('preview.prev_file', { defaultValue: 'Fichier précédent' }), keys: ['←'] },
        { label: t('preview.next_file', { defaultValue: 'Fichier suivant' }),   keys: ['→'] },
      ],
    },
    {
      title: t('preview.sc_actions', { defaultValue: 'Actions' }),
      rows: [
        { label: t('preview.sc_download', { defaultValue: 'Télécharger l’élément' }),             keys: ['Ctrl', 'D'] },
        { label: t('preview.sc_star',     { defaultValue: 'Activer/Désactiver le suivi' }),       keys: ['S'] },
        { label: t('preview.sc_details',  { defaultValue: 'Afficher/Masquer le volet Détails' }), keys: ['D'] },
        { label: t('preview.shortcuts',   { defaultValue: 'Raccourcis clavier' }),                keys: ['Ctrl', '/'] },
      ],
    },
    ...(ext.shortcutSections ?? []),
  ], [t, ext.shortcutSections])

  // ── Keyboard ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Viewer-specific bindings run first (search, zoom, page nav…).
      if (ext.onKey?.(e)) return
      const target = e.target as HTMLElement | null
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (e.key === 'Escape') {
        if (menuOpen) { setMenuOpen(null); return }
        onClose()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); handleDownload(); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p' && ext.onPrint) { e.preventDefault(); void ext.onPrint(); return }
      if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); setShortcutsOpen(true); return }
      if (typing) return
      if (e.key === 'd' || e.key === 'D') { setShowDetails(v => !v); return }
      if (e.key === 's' || e.key === 'S') { handleStar(); return }
      if (e.key === 'ArrowLeft')  prevFile()
      if (e.key === 'ArrowRight') nextFile()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, onClose, handleDownload, handleStar, prevFile, nextFile, ext.onKey, ext.onPrint])

  const shellApi = useMemo<PreviewShellApi>(() => ({
    requestClose: () => {
      setMenuOpen(prev => {
        if (prev) return null
        onClose()
        return prev
      })
    },
  }), [onClose])

  // ── Render ─────────────────────────────────────────────────────────────────
  const menuBtnCls = (id: string) =>
    `px-2 py-0.5 rounded text-xs transition-colors ${menuOpen?.id === id ? 'bg-white/20 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white'}`

  const railWidth = ext.railWidth ?? 0

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col select-none"
      style={{ background: 'rgba(22,22,24,0.98)' }}
      // Swallow the context menu so the explorer's own right-click menu can't
      // bleed through the previewer; viewers may show their own menu instead.
      onContextMenu={e => {
        e.preventDefault()
        e.stopPropagation()
        ext.onContextMenu?.(e)
      }}
    >

      {/* ── Header: close + icon + name + menubar | open with, share, prev/next ── */}
      <div className="flex items-start justify-between gap-3 pl-2 pr-3 pt-2 pb-1 shrink-0">
        <div className="flex items-start gap-2 min-w-0">
          <button
            onClick={onClose}
            title={t('viewer.close_esc', { defaultValue: 'Fermer (Échap)' })}
            className="p-2 mt-0.5 hover:bg-white/10 rounded-full text-white transition-colors shrink-0"
          >
            <X size={18} />
          </button>
          <div className="mt-1 shrink-0"><FileTypeChip mime={current.mime_type} /></div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-white text-[15px] truncate max-w-[42vw]">{current.name}</span>
              <button
                onClick={() => onMove(current)}
                title={t('ctx.move', { defaultValue: 'Déplacer' })}
                className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors shrink-0"
              >
                <FolderInput size={15} />
              </button>
            </div>
            <div className="flex items-center gap-0.5 mt-0.5 -ml-1">
              <button className={menuBtnCls('file')} onClick={openMenu('file')} onMouseEnter={switchMenu('file')}>
                {t('preview.menu_file', { defaultValue: 'Fichier' })}
              </button>
              {(ext.viewMenu?.length ?? 0) > 0 && (
                <button className={menuBtnCls('view')} onClick={openMenu('view')} onMouseEnter={switchMenu('view')}>
                  {t('preview.menu_view', { defaultValue: 'Afficher' })}
                </button>
              )}
              {extMenus.map(m => (
                <button key={m.id} className={menuBtnCls(m.id)} onClick={openMenu(m.id)} onMouseEnter={switchMenu(m.id)}>
                  {m.label}
                </button>
              ))}
              <button className={menuBtnCls('tools')} onClick={openMenu('tools')} onMouseEnter={switchMenu('tools')}>
                {t('preview.menu_tools', { defaultValue: 'Outils' })}
              </button>
              <button className={menuBtnCls('help')} onClick={openMenu('help')} onMouseEnter={switchMenu('help')}>
                {t('preview.menu_help', { defaultValue: 'Aide' })}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 mt-1">
          {openWith.length > 0 && (
            <button
              onClick={openMenu('openwith')}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs text-white bg-white/10 hover:bg-white/20 rounded-full transition-colors"
            >
              {t('ctx.open_with', { defaultValue: 'Ouvrir avec…' }).replace(/…$/, '')}
              <ChevronDown size={14} className="text-white/70" />
            </button>
          )}
          <div className="flex items-stretch rounded-full overflow-hidden">
            <button
              onClick={() => onShare(current)}
              className="flex items-center gap-1.5 pl-3.5 pr-2.5 py-2 text-xs bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            >
              <Share2 size={14} />
              {t('preview.share', { defaultValue: 'Partager' })}
            </button>
            <button
              onClick={openMenu('sharemore')}
              className="flex items-center px-1.5 bg-blue-600 hover:bg-blue-500 text-white border-l border-blue-400/40 transition-colors"
            >
              <ChevronDown size={14} />
            </button>
          </div>
          {list.length > 1 && (
            <>
              <div className="w-px h-6 bg-white/15 mx-1" />
              <span className="text-white/50 text-xs tabular-nums">{idx + 1} / {list.length}</span>
              <button
                onClick={prevFile}
                disabled={idx <= 0}
                title={t('preview.prev_file', { defaultValue: 'Fichier précédent' })}
                className="p-2 rounded-full border border-white/20 text-white hover:bg-white/10 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={nextFile}
                disabled={idx >= list.length - 1}
                title={t('preview.next_file', { defaultValue: 'Fichier suivant' })}
                className="p-2 rounded-full border border-white/20 text-white hover:bg-white/10 disabled:opacity-30 transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Toolbar row (pill centered over the viewer zone) ── */}
      <div
        className="relative flex items-center justify-center pb-2 shrink-0"
        style={{
          // Match the body's 56px gutter (+ rail width when shown) so the pill
          // stays centered over the viewer column.
          paddingLeft:  56 + railWidth,
          paddingRight: showDetails ? 320 : 0,
        }}
      >
        {ext.toolbar && (
          <div className="flex items-center gap-1 bg-white/10 rounded-full pl-4 pr-2 py-1 text-xs text-white/85">
            {ext.toolbar}
          </div>
        )}
        {ext.toolbarOverlay}
      </div>

      {/* ── Body: gutter | rail | viewer | details ── */}
      <div className="flex-1 flex min-h-0">
        {/* Left gutter (56px): rail-mode buttons on top, bottom-left toggle
            lives in the same column — nothing else ever covers this band. */}
        <div className="w-14 shrink-0 flex flex-col items-center pt-1 gap-1">
          {ext.railButtons}
        </div>

        {ext.rail}

        {children(shellApi)}

        {showDetails && (
          <PreviewDetailsPanel
            file={current}
            onClose={() => setShowDetails(false)}
            onManageAccess={() => onShare(current)}
          />
        )}
      </div>

      {/* Bottom-left: rail toggle (Drive-style) */}
      {ext.onToggleRail && (
        <button
          onClick={ext.onToggleRail}
          title={t('preview.thumbnails', { defaultValue: 'Vignettes de pages' })}
          className={`absolute bottom-3 left-3 p-2 rounded-lg transition-colors ${ext.railToggled ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
        >
          <PanelLeft size={18} />
        </button>
      )}

      {/* Footer hint: size (subtle, just above the toggle) */}
      <div className="absolute bottom-14 left-3 text-white/35 text-[11px] pointer-events-none">
        {formatSize(current.size_bytes)}
      </div>

      {/* Viewer-owned overlays (banners, cards, local dropdowns…) */}
      {ext.overlays}

      {/* Active dropdown menu. The provider feeds the « open with » slot
          contributors (they read the target file via useFilesOpenWith). */}
      {menuOpen && (
        <FilesOpenWithContext.Provider value={current}>
          <MenuDropdown
            items={activeMenuItems}
            pos={{ top: menuOpen.top, left: menuOpen.left, minWidth: 230 }}
            theme="dark"
            onClose={() => setMenuOpen(null)}
          />
        </FilesOpenWithContext.Provider>
      )}

      {/* Notification settings dialog (Outils > Gérer les notifications) */}
      {notifyDialogOpen && (
        <NotificationDialog
          mode={notifyMode}
          onCancel={() => setNotifyDialogOpen(false)}
          onSave={(m) => {
            setNotifyMode(m)
            localStorage.setItem(`drive:pdf-notify:${current.id}`, m)
            setNotifyDialogOpen(false)
          }}
        />
      )}

      {/* Keyboard shortcuts dialog (Aide > Raccourcis clavier) */}
      {shortcutsOpen && <ShortcutsDialog sections={shortcutSections} onClose={() => setShortcutsOpen(false)} />}
    </div>
  )
}
