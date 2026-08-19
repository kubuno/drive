/**
 * Drive home — the landing screen (desktop), reachable from the sidebar's
 * "Accueil" entry and the mobile "Home" tab.
 *
 * Layout mirrors the reference cloud drives: a welcome banner, a wide search
 * box, a row of filter chips (Type / Contacts / Modified date / Location), then
 * two suggestion sections — recently-used folders and recently-opened files.
 *
 * It reuses the module's own machinery rather than reinventing it:
 *  · the search box and chips drive the SAME `useFilesStore` search the header
 *    search uses, then hop to `/drive` where the results view renders;
 *  · files open through the shared URL previewer (`openPreview`) or their
 *    associated app (`FileTypeRegistry`), exactly like the explorer does;
 *  · icons/glyphs come from `getFileIcon` / `FolderGlyph` for pixel parity.
 *
 * On phones it defers to the existing `MobileHome` (bottom-nav tabs).
 */
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, type NavigateFunction } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow, parseISO } from 'date-fns'
import {
  Search, ChevronDown, MoreVertical, LayoutGrid, List as ListIcon,
  Download, FolderOpen, EyeOff, User as UserIcon, ChevronRight,
} from 'lucide-react'
import { MenuDropdown, type MenuItem, type MenuDropdownPos } from '@ui'
import {
  filesApi, recentApi, getFileIcon, FolderGlyph,
  useFilesStore, type FileItem, type Folder, type FilesSearchFilters,
} from '@kubuno/drive'
import { FileTypeRegistry, ModuleServiceRegistry, getDateLocale } from '@kubuno/sdk'
import { useIsMobile } from './openable'
import { openPreview, canPreview } from './previewService'
import { SEARCH_PARAM } from './drive-app/types'
import MobileHome from './MobileHome'

type RecentItem = FileItem & { opened_at?: string }

// ── File opening ──────────────────────────────────────────────────────────────
// Same priority as the explorer's `openFile`: an explicit "open with" app, then
// the format's associated app (documents, spreadsheets…), then the shared URL
// previewer for renderable media, and finally a plain download.

function openRecentFile(file: FileItem, navigate: NavigateFunction): void {
  const isMedia = file.mime_type.startsWith('image/') || file.mime_type.startsWith('video/')
    || file.mime_type.startsWith('audio/') || file.mime_type === 'application/pdf'

  const openWith = typeof file.metadata?.['open_with'] === 'string' ? file.metadata['open_with'] as string : null
  if (openWith) {
    const decl = FileTypeRegistry.get(openWith)
    if (decl?.open) { decl.open(file, navigate); return }
    if (ModuleServiceRegistry.call<boolean>(openWith, 'openFile', file, navigate)) return
  }
  // An associated editor wins for app formats (kb docs, sheets…) but never
  // hijacks media, which belongs in the previewer.
  const opener = FileTypeRegistry.openersFor(file)[0]
  if (opener?.open && !isMedia) { opener.open(file, navigate); return }
  if (canPreview(file.mime_type, file.name)
      && openPreview({ url: filesApi.downloadUrl(file.id), name: file.name, mime: file.mime_type })) return
  if (opener?.open) { opener.open(file, navigate); return }
  window.open(filesApi.downloadUrl(file.id), '_blank')
}

// ── Suggestions data ──────────────────────────────────────────────────────────

/** Folders the user recently worked in (parents of recently-opened files),
 *  padded with top-level folders so the row never looks empty. */
function useSuggestedFolders() {
  return useQuery({
    queryKey: ['home-suggested-folders'],
    staleTime: 60_000,
    queryFn: async (): Promise<Folder[]> => {
      const recents = await recentApi.list({ limit: 40 }).catch(() => [] as RecentItem[])
      const seen = new Set<string>()
      const ids: string[] = []
      for (const f of recents) {
        const fid = f.folder_id
        if (fid && !seen.has(fid)) { seen.add(fid); ids.push(fid) }
      }
      const derived = (await Promise.all(
        ids.slice(0, 8).map(id => filesApi.getFolder(id).then(r => r.folder).catch(() => null)),
      )).filter((f): f is Folder => !!f && !f.is_trashed)

      const out = [...derived]
      if (out.length < 7) {
        const { folders: roots } = await filesApi.listFolders(null).catch(() => ({ folders: [] as Folder[] }))
        for (const r of roots) {
          if (out.length >= 7) break
          if (!out.some(m => m.id === r.id)) out.push(r)
        }
      }
      return out.slice(0, 7)
    },
  })
}

/** Recently-opened files, newest first (the cross-app "recent" journal). */
function useSuggestedFiles() {
  return useQuery({
    queryKey: ['home-suggested-files'],
    staleTime: 30_000,
    queryFn: (): Promise<RecentItem[]> => recentApi.list({ limit: 24 }).catch(() => []),
  })
}

// ── Small building blocks ─────────────────────────────────────────────────────

/** A rounded filter chip that opens a menu of mutually-exclusive choices. */
function FilterChip({ label, active, onOpen }: {
  label: string; active: boolean; onOpen: (pos: MenuDropdownPos) => void
}) {
  return (
    <button
      type="button"
      onClick={e => {
        const r = e.currentTarget.getBoundingClientRect()
        onOpen({ top: r.bottom + 4, left: r.left, minWidth: 220 })
      }}
      className={`inline-flex items-center gap-1.5 h-9 pl-3.5 pr-2.5 rounded-full border text-sm transition-colors
                  ${active
                    ? 'border-primary/40 bg-primary-light text-primary'
                    : 'border-border text-text-secondary hover:bg-surface-2'}`}
    >
      <span>{label}</span>
      <ChevronDown size={16} className="opacity-70" />
    </button>
  )
}

function SuggestedFolderCard({ folder, onOpen, onKebab }: {
  folder: Folder
  onOpen: () => void
  onKebab: (pos: MenuDropdownPos) => void
}) {
  const { t } = useTranslation('drive')
  return (
    <div
      onDoubleClick={onOpen}
      onClick={onOpen}
      className="group relative flex items-center gap-3 h-14 px-3 rounded-lg border border-border bg-surface
                 hover:bg-[#e4ecf7] hover:border-border cursor-pointer select-none min-w-0"
    >
      <FolderGlyph folder={folder} size={22} className="shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary truncate">{folder.name}</div>
        <div className="text-xs text-text-tertiary truncate">
          {t('home.in_my_drive', { defaultValue: 'dans Mon Drive' })}
        </div>
      </div>
      <button
        type="button"
        aria-label={t('common.more', { defaultValue: 'Plus' })}
        onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onKebab({ top: r.bottom + 4, left: r.left - 160, minWidth: 200 }) }}
        className="shrink-0 w-8 h-8 rounded-full inline-flex items-center justify-center text-text-secondary
                   opacity-0 group-hover:opacity-100 hover:bg-black/5 transition-opacity"
      >
        <MoreVertical size={18} />
      </button>
    </div>
  )
}

function SuggestedFileCard({ file, onOpen, onKebab }: {
  file: RecentItem
  onOpen: () => void
  onKebab: (pos: MenuDropdownPos) => void
}) {
  const { t } = useTranslation('drive')
  const isImage = file.mime_type.startsWith('image/')
  const isVideo = file.mime_type.startsWith('video/')
  const [thumbErr, setThumbErr] = useState(false)
  const showThumb = (isImage || isVideo) && file.has_thumbnail && !thumbErr
  const opened = file.opened_at
    ? formatDistanceToNow(parseISO(file.opened_at), { locale: getDateLocale(), addSuffix: true })
    : formatDistanceToNow(parseISO(file.updated_at), { locale: getDateLocale(), addSuffix: true })

  return (
    <div
      onDoubleClick={onOpen}
      onClick={onOpen}
      className="group relative flex flex-col rounded-xl border border-border bg-surface overflow-hidden
                 hover:border-primary/40 hover:shadow-sm cursor-pointer select-none"
    >
      {/* Header: type icon + name + kebab */}
      <div className="flex items-center gap-2 h-11 px-3 border-b border-border">
        <span className="shrink-0 flex items-center [&_svg]:w-[18px] [&_svg]:h-[18px]">
          {getFileIcon(file.mime_type, file.name)}
        </span>
        <span className="flex-1 min-w-0 truncate text-sm text-text-primary">{file.name}</span>
        <button
          type="button"
          aria-label={t('common.more', { defaultValue: 'Plus' })}
          onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onKebab({ top: r.bottom + 4, left: r.left - 180, minWidth: 210 }) }}
          className="shrink-0 w-8 h-8 rounded-full inline-flex items-center justify-center text-text-secondary
                     opacity-0 group-hover:opacity-100 hover:bg-black/5 transition-opacity"
        >
          <MoreVertical size={18} />
        </button>
      </div>

      {/* Thumbnail / big type icon */}
      <div className="h-[150px] bg-surface-2 flex items-center justify-center overflow-hidden">
        {showThumb ? (
          <img
            src={filesApi.thumbnailUrl(file.id)}
            alt=""
            loading="lazy"
            onError={() => setThumbErr(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="scale-[2.2] opacity-90 [&_svg]:w-6 [&_svg]:h-6">
            {getFileIcon(file.mime_type, file.name)}
          </div>
        )}
      </div>

      {/* Footer caption */}
      <div className="flex items-center gap-2 h-10 px-3">
        <span className="shrink-0 w-5 h-5 rounded-full bg-primary-light text-primary inline-flex items-center justify-center">
          <UserIcon size={12} />
        </span>
        <span className="flex-1 min-w-0 truncate text-xs text-text-tertiary">
          {t('home.opened_by_you', { defaultValue: 'Ouvert par vous' })} · {opened}
        </span>
      </div>
    </div>
  )
}

/** One row of the list (compact) variant of the suggested files. */
function SuggestedFileRow({ file, onOpen, onKebab }: {
  file: RecentItem
  onOpen: () => void
  onKebab: (pos: MenuDropdownPos) => void
}) {
  const { t } = useTranslation('drive')
  const opened = file.opened_at
    ? formatDistanceToNow(parseISO(file.opened_at), { locale: getDateLocale(), addSuffix: true })
    : formatDistanceToNow(parseISO(file.updated_at), { locale: getDateLocale(), addSuffix: true })
  return (
    <div
      onDoubleClick={onOpen}
      onClick={onOpen}
      className="group flex items-center gap-3 h-12 px-3 rounded-lg border border-border bg-surface
                 hover:bg-[#e4ecf7] cursor-pointer select-none"
    >
      <span className="shrink-0 flex items-center [&_svg]:w-[18px] [&_svg]:h-[18px]">
        {getFileIcon(file.mime_type, file.name)}
      </span>
      <span className="flex-1 min-w-0 truncate text-sm text-text-primary">{file.name}</span>
      <span className="shrink-0 text-xs text-text-tertiary hidden sm:block">
        {t('home.opened_by_you', { defaultValue: 'Ouvert par vous' })} · {opened}
      </span>
      <button
        type="button"
        aria-label={t('common.more', { defaultValue: 'Plus' })}
        onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onKebab({ top: r.bottom + 4, left: r.left - 180, minWidth: 210 }) }}
        className="shrink-0 w-8 h-8 rounded-full inline-flex items-center justify-center text-text-secondary
                   opacity-0 group-hover:opacity-100 hover:bg-black/5 transition-opacity"
      >
        <MoreVertical size={18} />
      </button>
    </div>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

function DesktopHome() {
  const { t } = useTranslation('drive')
  const navigate = useNavigate()
  const filters = useFilesStore(s => s.searchFilters)

  const [query, setQuery] = useState('')
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [menu, setMenu] = useState<{ items: MenuItem[]; pos: MenuDropdownPos } | null>(null)

  const { data: folders = [], isLoading: foldersLoading } = useSuggestedFolders()
  const { data: files = [], isLoading: filesLoading } = useSuggestedFiles()

  const openMenu = (items: MenuItem[], pos: MenuDropdownPos) => setMenu({ items, pos })

  // Run a text search: hop to the explorer with the query in the URL, which is
  // the search's source of truth there (`useDriveSearchUrlSync`). Setting the
  // store then navigating would be wiped by that URL→state restore on mount.
  const runSearch = useCallback((q: string) => {
    const query = q.trim()
    if (!query) return
    navigate(`/drive?${SEARCH_PARAM}=${encodeURIComponent(query)}`)
  }, [navigate])

  const applyFilter = useCallback((partial: Partial<FilesSearchFilters>) => {
    const s = useFilesStore.getState()
    s.setSearchFilters(partial)
    s.applySearch()
    navigate('/drive')
  }, [navigate])

  // Chip → menu items. `checked` mirrors the current filter so a second visit
  // shows what is active.
  const chip = <K extends keyof FilesSearchFilters>(
    key: K, opts: Array<[FilesSearchFilters[K], string]>,
  ): MenuItem[] => opts.map(([value, label]) => ({
    type: 'action', label, checked: filters[key] === value,
    onClick: () => applyFilter({ [key]: value } as Partial<FilesSearchFilters>),
  }))

  const typeChip = () => chip('type', [
    ['all', t('filter.t_all')], ['folder', t('filter.t_folder')], ['document', t('filter.t_document')],
    ['spreadsheet', t('filter.t_spreadsheet')], ['presentation', t('filter.t_presentation')],
    ['pdf', t('filter.t_pdf')], ['image', t('filter.t_image')], ['video', t('filter.t_video')],
    ['audio', t('filter.t_audio')], ['archive', t('filter.t_archive')],
  ])
  const ownerChip = () => chip('owner', [
    ['anyone', t('filter.o_anyone')], ['me', t('filter.o_me')], ['notme', t('filter.o_notme')],
  ])
  const dateChip = () => chip('modifiedDate', [
    ['anytime', t('filter.d_anytime')], ['today', t('filter.d_today')], ['7days', t('filter.d_7days')],
    ['30days', t('filter.d_30days')], ['thisyear', t('filter.d_thisyear')], ['lastyear', t('filter.d_lastyear')],
  ])
  const locationChip = () => chip('location', [
    ['everywhere', t('filter.loc_everywhere')], ['mydrive', t('tree.my_drive')],
  ])

  const chips: Array<{ label: string; active: boolean; items: () => MenuItem[] }> = [
    { label: filters.type !== 'all' ? t(`filter.t_${filters.type}`) : t('filter.type'), active: filters.type !== 'all', items: typeChip },
    { label: t('filter.owner'), active: filters.owner !== 'anyone', items: ownerChip },
    { label: filters.modifiedDate !== 'anytime' ? t(`filter.d_${filters.modifiedDate}`) : t('filter.modified'), active: filters.modifiedDate !== 'anytime', items: dateChip },
    { label: filters.location !== 'everywhere' ? t('tree.my_drive') : t('filter.location'), active: filters.location !== 'everywhere', items: locationChip },
  ]

  const folderMenu = (folder: Folder): MenuItem[] => [
    { type: 'action', label: t('common.open', { defaultValue: 'Ouvrir' }), icon: <FolderOpen size={15} />, onClick: () => navigate(`/drive?folder=${folder.id}`) },
  ]
  const fileMenu = (file: RecentItem): MenuItem[] => [
    { type: 'action', label: t('common.open', { defaultValue: 'Ouvrir' }), icon: <FolderOpen size={15} />, onClick: () => openRecentFile(file, navigate) },
    { type: 'action', label: t('common.download', { defaultValue: 'Télécharger' }), icon: <Download size={15} />, onClick: () => window.open(filesApi.downloadUrl(file.id), '_blank') },
    ...(file.folder_id ? [{ type: 'action' as const, label: t('home.open_location', { defaultValue: 'Ouvrir l’emplacement' }), icon: <FolderOpen size={15} />, onClick: () => navigate(`/drive?folder=${file.folder_id}`) }] : []),
    { type: 'separator' },
    { type: 'action', label: t('home.remove_suggestion', { defaultValue: 'Retirer des suggestions' }), icon: <EyeOff size={15} />, onClick: () => { void recentApi.remove(file.id).then(() => useFilesStore.getState().refresh?.()) } },
  ]

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-surface">
      <div className="max-w-[1400px] mx-auto px-6 pb-16">
        {/* Welcome + search */}
        <div className="pt-8 pb-2">
          <h1 className="text-center text-[26px] leading-tight text-text-primary">
            {t('home.welcome', { defaultValue: 'Bienvenue dans Drive' })}
          </h1>

          <div className="mt-6 mx-auto max-w-[720px]">
            <div className="flex items-center gap-3 h-12 px-5 rounded-full bg-surface-2 border border-transparent
                            focus-within:bg-surface focus-within:border-border focus-within:shadow-sm transition-all">
              <Search size={20} className="shrink-0 text-text-secondary" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); runSearch(e.currentTarget.value) } }}
                placeholder={t('home.search_ph', { defaultValue: 'Rechercher dans Drive' })}
                className="flex-1 min-w-0 bg-transparent outline-none text-[15px] text-text-primary placeholder:text-text-tertiary"
              />
            </div>
          </div>

          {/* Filter chips */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {chips.map((c, i) => (
              <FilterChip key={i} label={c.label} active={c.active}
                onOpen={pos => openMenu(c.items(), pos)} />
            ))}
          </div>
        </div>

        {/* Suggested folders */}
        <section className="mt-8">
          <h2 className="text-[15px] font-medium text-text-primary mb-3">
            {t('home.suggested_folders', { defaultValue: 'Dossiers suggérés' })}
          </h2>
          {foldersLoading ? (
            <SkeletonRow height={56} />
          ) : folders.length === 0 ? (
            <p className="text-sm text-text-tertiary">{t('home.no_folders', { defaultValue: 'Aucun dossier récent' })}</p>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
              {folders.map(f => (
                <SuggestedFolderCard key={f.id} folder={f}
                  onOpen={() => navigate(`/drive?folder=${f.id}`)}
                  onKebab={pos => openMenu(folderMenu(f), pos)} />
              ))}
            </div>
          )}
        </section>

        {/* Suggested files */}
        <section className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px] font-medium text-text-primary">
              {t('home.suggested_files', { defaultValue: 'Fichiers suggérés' })}
            </h2>
            <div className="inline-flex items-center rounded-full border border-border overflow-hidden">
              <button type="button" aria-label={t('app.view_list', { defaultValue: 'Vue liste' })}
                onClick={() => setLayout('list')}
                className={`w-9 h-8 inline-flex items-center justify-center ${layout === 'list' ? 'bg-primary-light text-primary' : 'text-text-secondary hover:bg-surface-2'}`}>
                <ListIcon size={17} />
              </button>
              <button type="button" aria-label={t('app.view_grid', { defaultValue: 'Vue grille' })}
                onClick={() => setLayout('grid')}
                className={`w-9 h-8 inline-flex items-center justify-center ${layout === 'grid' ? 'bg-primary-light text-primary' : 'text-text-secondary hover:bg-surface-2'}`}>
                <LayoutGrid size={17} />
              </button>
            </div>
          </div>

          {filesLoading ? (
            <SkeletonRow height={layout === 'grid' ? 220 : 48} grid={layout === 'grid'} />
          ) : files.length === 0 ? (
            <p className="text-sm text-text-tertiary">{t('app.empty_recent', { defaultValue: 'Aucun fichier récent' })}</p>
          ) : layout === 'grid' ? (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
              {files.map(f => (
                <SuggestedFileCard key={f.id} file={f}
                  onOpen={() => openRecentFile(f, navigate)}
                  onKebab={pos => openMenu(fileMenu(f), pos)} />
              ))}
            </div>
          ) : (
            <div className="space-y-1.5">
              {files.map(f => (
                <SuggestedFileRow key={f.id} file={f}
                  onOpen={() => openRecentFile(f, navigate)}
                  onKebab={pos => openMenu(fileMenu(f), pos)} />
              ))}
            </div>
          )}

          {files.length > 0 && (
            <button
              type="button"
              onClick={() => navigate('/drive/recent')}
              className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              {t('home.see_more', { defaultValue: 'Voir plus' })}
              <ChevronRight size={16} />
            </button>
          )}
        </section>
      </div>

      {menu && <MenuDropdown items={menu.items} pos={menu.pos} onClose={() => setMenu(null)} />}
    </div>
  )
}

/** Lightweight loading placeholder (avoids a spinner popping the layout). */
function SkeletonRow({ height, grid }: { height: number; grid?: boolean }) {
  const cells = Array.from({ length: grid ? 6 : 4 })
  return (
    <div className={grid ? 'grid gap-3' : 'grid gap-3'}
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${grid ? 210 : 230}px, 1fr))` }}>
      {cells.map((_, i) => (
        <div key={i} className="rounded-xl bg-surface-2 animate-pulse" style={{ height }} />
      ))}
    </div>
  )
}

export default function DriveHome() {
  const isMobile = useIsMobile()
  return isMobile ? <MobileHome /> : <DesktopHome />
}
