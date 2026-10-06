/**
 * The parts of `FilesTreeSidebar.kbcontrol` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { useState, useMemo } from "react"
import { Link as RouterLink } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { Folder as FolderIcon, FolderOpen, ChevronRight, Clock, Trash2, HardDrive, Server, Settings2, ServerCog, Search, X, Cloud, Home } from "lucide-react"
import { MenuDropdown } from "@ui"
import { filesApi, FolderGlyph, type Folder, type RemoteConnection, type RemoteEntry } from "@kubuno/drive"
import { usePendingKind, pendingBoxClass, pendingBoxStyle, useAuthStore } from "@kubuno/sdk"
import { tagColorHex } from "../model/driveExtras"
import { ModuleServiceRegistry } from "@kubuno/sdk"
import { formatSize } from "@kubuno/drive"
import { hashTo } from "../services/hashRoute"
import type { FilesTreeSidebar } from './FilesTreeSidebar'
const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-primary'

const hoverBg = (color: string) => ({
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.backgroundColor = color },
  onMouseLeave: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.backgroundColor = '' },
})

const ROW_HOVER = 'var(--kb-sidebar-hover, #e8eaed)'

type TFn = (key: string, opts?: Record<string, unknown>) => string

const REMOTE_STATUS_COLOR: Record<RemoteConnection['status'], string> = {
  connected: '#1e8e3e', syncing: '#1a73e8', error: '#d93025', disconnected: '#80868b',
}

type MountFolder = { id: string; name: string }

type MountSource = { list: (parentId: string | null) => Promise<{ folders: MountFolder[]; files: unknown[] }> }

function ExpandToggle({ expanded, onToggle, label }: {
  expanded: boolean; onToggle: () => void; label: string
}) {
  return (
    <a
      href="#"
      role="button"
      aria-label={label}
      aria-expanded={expanded}
      className={`shrink-0 inline-flex items-center justify-center p-0.5 rounded cursor-pointer ${FOCUS_RING}`}
      style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
      {...hoverBg('rgba(0,0,0,0.1)')}
      onClick={e => { e.preventDefault(); e.stopPropagation(); onToggle() }}
      onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); onToggle() } }}
    >
      <ChevronRight size={14} className="text-text-tertiary" />
    </a>
  )
}
export { ExpandToggle }

function DrawerLink({ icon, label, active, to }: {
  icon: React.ReactNode; label: string; active?: boolean; to: string
}) {
  return (
    <RouterLink
      to={to}
      className={`w-full flex items-center gap-4 h-[52px] px-4 rounded-r-full text-left text-[15px] transition-colors cursor-pointer ${FOCUS_RING}
                  ${active ? 'bg-primary-light text-primary font-medium' : 'text-text-primary active:bg-surface-2'}`}
    >
      <span className={`shrink-0 ${active ? 'text-primary' : 'text-text-secondary'}`}>{icon}</span>
      <span className="flex-1 min-w-0 truncate">{label}</span>
    </RouterLink>
  )
}
export { DrawerLink }

function MobileDrawerNav({ t, pathname, isInDrive, isRecent, isTrashed, isSystem, isAdmin, moduleMounts, remotes }: {
  t: TFn
  pathname: string
  isInDrive: boolean; isRecent: boolean; isTrashed: boolean; isSystem: boolean
  isAdmin: boolean
  moduleMounts: Array<{ moduleId: string; key: string; name: string }>
  remotes: RemoteConnection[]
}) {
  const user = useAuthStore(s => s.user)
  const pct = user && user.quota_bytes > 0
    ? Math.min(100, Math.round((user.used_bytes / user.quota_bytes) * 100))
    : null
  const barColor = pct == null ? '' : pct > 90 ? 'bg-danger' : pct > 70 ? 'bg-warning' : 'bg-primary'

  return (
    <div className="flex-1 flex flex-col overflow-y-auto py-2 pr-2">
      <nav className="space-y-0.5">
        <DrawerLink icon={<Home size={22} />} label={t('nav.home', { defaultValue: 'Accueil' })}
          active={pathname === '/drive/home'} to="/drive/home" />
        <DrawerLink icon={<HardDrive size={22} />} label={t('tree.my_drive', { defaultValue: 'Mon Drive' })}
          active={isInDrive} to="/drive" />
        <DrawerLink icon={<Clock size={22} />} label={t('nav.recent')}
          active={isRecent} to="/drive/recent" />
        {moduleMounts.map(mt => (
          <DrawerLink key={`${mt.moduleId}:${mt.key}`} icon={<Cloud size={22} />} label={mt.name}
            active={pathname === `/drive/m/${mt.moduleId}/${mt.key}`}
            to={`/drive/m/${mt.moduleId}/${mt.key}`} />
        ))}
        {remotes.map(r => (
          <DrawerLink key={r.id} icon={<Server size={22} />} label={r.name}
            active={pathname === `/drive/remote/${r.id}`}
            to={`/drive/remote/${r.id}`} />
        ))}
        <DrawerLink icon={<Trash2 size={22} />} label={t('nav.trash')}
          active={isTrashed} to="/drive/trash" />
        {isAdmin && (
          <DrawerLink icon={<ServerCog size={22} />} label={t('nav.system', { defaultValue: 'Système' })}
            active={isSystem} to="/drive/system" />
        )}
        <DrawerLink icon={<Settings2 size={22} />} label={t('nav.storage_settings')}
          active={pathname === '/drive/settings'} to="/drive/settings" />
      </nav>

      {/* Storage gauge — the header one is desktop-only, so this is the ONLY
          place a phone user sees their quota. */}
      {pct != null && user && (
        <div className="mt-auto pt-4 px-4 pb-2">
          <div className="flex items-center gap-2 mb-2 text-text-secondary">
            <Cloud size={20} />
            <span className="text-[15px]">{t('storage.title')}</span>
          </div>
          <div className="h-1.5 w-full bg-black/10 rounded-full overflow-hidden mb-2">
            <div className={`h-full ${barColor} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-text-secondary mb-3">
            {formatSize(user.used_bytes)} / {formatSize(user.quota_bytes)}
          </p>
          <RouterLink
            to="/drive/storage"
            className={`w-full h-10 flex items-center justify-center rounded-md border border-border text-primary text-sm font-medium active:bg-surface-2 transition-colors cursor-pointer ${FOCUS_RING}`}
          >
            {t('storage.manage', { defaultValue: 'Gérer le stockage' })}
          </RouterLink>
        </div>
      )}
    </div>
  )
}
export { MobileDrawerNav }

function TreeNode({
  folder, depth, activeFolderId, contextMenuFolderId, refreshKey, linkFor, onContextMenu,
}: {
  folder: Folder
  depth: number
  activeFolderId: string | null
  contextMenuFolderId: string | null
  refreshKey: number
  /** Builds the real href of a folder — the row navigates through a <Link>. */
  linkFor: (id: string | null) => string
  onContextMenu: (folder: Folder, x: number, y: number) => void
}) {
  const { t } = useTranslation('drive')
  const [expanded, setExpanded] = useState(false)
  const pendingKind = usePendingKind(folder.id)
  const isActive = activeFolderId === folder.id
  const isContextTarget = contextMenuFolderId === folder.id

  const { data } = useQuery({
    queryKey: ['tree-children', folder.id, refreshKey],
    queryFn: () => filesApi.listFolders(folder.id),
    enabled: expanded,
  })

  const children = data?.folders ?? []

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const vw = window.innerWidth
    const vh = window.innerHeight
    onContextMenu(folder, Math.min(e.clientX, vw - 200), Math.min(e.clientY, vh - 320))
  }

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 rounded-full cursor-pointer select-none
          ${isActive ? 'bg-primary-light' : isContextTarget ? 'bg-surface-3' : ''} ${pendingBoxClass(pendingKind)}`}
        style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: '8px', ...pendingBoxStyle(pendingKind) }}
        {...(isActive || isContextTarget ? {} : hoverBg(ROW_HOVER))}
        onContextMenu={handleContextMenu}
      >
        <ExpandToggle
          expanded={expanded}
          onToggle={() => setExpanded(v => !v)}
          label={expanded ? t('common.collapse') : t('common.expand')}
        />
        <RouterLink
          to={linkFor(folder.id)}
          className={`flex-1 min-w-0 flex items-center gap-1 self-stretch -my-1 py-1 pr-2 -mr-2 rounded-full cursor-pointer ${FOCUS_RING}`}
        >
          <FolderGlyph folder={folder} size={15} className="shrink-0" color={isActive ? '#1a73e8' : undefined} />
          <span
            className="text-sm truncate ml-1 flex-1"
            style={{ color: isActive ? 'var(--color-text-nav-active)' : 'var(--color-text-nav)' }}
          >
            {folder.name}
          </span>
        </RouterLink>
      </div>

      {expanded && children.map(child => (
        <TreeNode
          key={child.id}
          folder={child}
          depth={depth + 1}
          activeFolderId={activeFolderId}
          contextMenuFolderId={contextMenuFolderId}
          refreshKey={refreshKey}
          linkFor={linkFor}
          onContextMenu={onContextMenu}
        />
      ))}
      {expanded && data && children.length === 0 && (
        <p
          className="text-xs text-text-tertiary italic py-0.5"
          style={{ paddingLeft: `${8 + (depth + 1) * 16 + 22}px` }}
        >
          {t('common.empty')}
        </p>
      )}
    </div>
  )
}
export { TreeNode }

function DriveRootSection({
  activeFolderId, contextMenuFolderId, isInDrive, refreshKey, linkFor, onContextMenu, onHeaderContextMenu,
}: {
  activeFolderId: string | null
  contextMenuFolderId: string | null
  isInDrive: boolean
  refreshKey: number
  /** Builds the real href of a folder (null = the drive root). */
  linkFor: (id: string | null) => string
  onContextMenu: (folder: Folder, x: number, y: number) => void
  onHeaderContextMenu?: (e: React.MouseEvent) => void
}) {
  const { t } = useTranslation('drive')
  // Collapsed by default (user request).
  const [expanded, setExpanded] = useState(false)

  const { data } = useQuery({
    queryKey: ['tree-children', null, refreshKey],
    queryFn: () => filesApi.listFolders(null),
    enabled: expanded,
  })

  const folders = data?.folders ?? []
  const isRootActive = isInDrive && activeFolderId === null

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-3 py-2 rounded-full cursor-pointer select-none
          ${isRootActive ? 'bg-primary-light' : ''}`}
        {...(isRootActive ? {} : hoverBg(ROW_HOVER))}
        onContextMenu={onHeaderContextMenu}
      >
        <ExpandToggle
          expanded={expanded}
          onToggle={() => setExpanded(v => !v)}
          label={expanded ? t('tree.collapse_drive') : t('tree.expand_drive')}
        />
        <RouterLink
          to={linkFor(null)}
          className={`flex-1 min-w-0 flex items-center gap-1 self-stretch -my-2 py-2 pr-3 -mr-3 rounded-full cursor-pointer ${FOCUS_RING}`}
        >
          <FolderOpen
            size={20}
            className="shrink-0"
            style={{ color: isRootActive ? '#1a73e8' : '#5f6368' }}
          />
          <span
            className="text-sm truncate ml-1 flex-1"
            style={{ color: isRootActive ? 'var(--color-text-nav-active)' : 'var(--color-text-nav)' }}
          >
            {t('tree.my_drive')}
          </span>
        </RouterLink>
      </div>

      {expanded && (
        <div className="pl-4">
          {folders.map(folder => (
            <TreeNode
              key={folder.id}
              folder={folder}
              depth={0}
              activeFolderId={activeFolderId}
              contextMenuFolderId={contextMenuFolderId}
              refreshKey={refreshKey}
              linkFor={linkFor}
              onContextMenu={onContextMenu}
            />
          ))}
          {data && folders.length === 0 && (
            <p className="text-xs text-text-tertiary italic py-1 pl-6">{t('common.empty')}</p>
          )}
        </div>
      )}
    </div>
  )
}
export { DriveRootSection }

function RemoteTreeNode({
  remoteId, entry, depth, activeRemoteId, activePath, linkFor,
}: {
  remoteId: string
  entry: RemoteEntry
  depth: number
  activeRemoteId: string | null
  activePath: string
  /** Builds the real href of a remote folder. */
  linkFor: (remoteId: string, path: string) => string
}) {
  const { t } = useTranslation('drive')
  const [expanded, setExpanded] = useState(false)
  const isActive = activeRemoteId === remoteId && activePath === entry.path

  const { data } = useQuery({
    queryKey: ['remote-browse', remoteId, entry.path],
    queryFn:  () => filesApi.browseRemote(remoteId, entry.path),
    enabled:  expanded,
    retry:    false,
  })
  const childDirs = (data ?? []).filter(e => e.is_dir)

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 rounded-full cursor-pointer select-none
          ${isActive ? 'bg-primary-light' : ''}`}
        style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: '8px' }}
        {...(isActive ? {} : hoverBg(ROW_HOVER))}
      >
        <ExpandToggle
          expanded={expanded}
          onToggle={() => setExpanded(v => !v)}
          label={expanded ? t('common.collapse') : t('common.expand')}
        />
        <RouterLink
          to={linkFor(remoteId, entry.path)}
          className={`flex-1 min-w-0 flex items-center gap-1 self-stretch -my-1 py-1 pr-2 -mr-2 rounded-full cursor-pointer ${FOCUS_RING}`}
        >
          <FolderIcon size={15} className="shrink-0" style={{ color: isActive ? '#1a73e8' : '#5f6368' }} fill="currentColor" />
          <span className="text-sm truncate ml-1 flex-1" style={{ color: isActive ? 'var(--color-text-nav-active)' : 'var(--color-text-nav)' }}>
            {entry.name}
          </span>
        </RouterLink>
      </div>
      {expanded && childDirs.map(child => (
        <RemoteTreeNode
          key={child.path} remoteId={remoteId} entry={child} depth={depth + 1}
          activeRemoteId={activeRemoteId} activePath={activePath} linkFor={linkFor}
        />
      ))}
    </div>
  )
}
export { RemoteTreeNode }

function RemoteSection({
  remote, activeRemoteId, activePath, linkFor, onHeaderContextMenu,
}: {
  remote: RemoteConnection
  activeRemoteId: string | null
  activePath: string
  /** Builds the real href of a remote folder. */
  linkFor: (remoteId: string, path: string) => string
  onHeaderContextMenu?: (e: React.MouseEvent) => void
}) {
  const { t } = useTranslation('drive')
  const [expanded, setExpanded] = useState(false)
  const isRootActive = activeRemoteId === remote.id && activePath === ''

  const { data } = useQuery({
    queryKey: ['remote-browse', remote.id, ''],
    queryFn:  () => filesApi.browseRemote(remote.id, ''),
    enabled:  expanded,
    retry:    false,
  })
  const dirs = (data ?? []).filter(e => e.is_dir)

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-3 py-2 rounded-full cursor-pointer select-none
          ${isRootActive ? 'bg-primary-light' : ''}`}
        {...(isRootActive ? {} : hoverBg(ROW_HOVER))}
        onContextMenu={onHeaderContextMenu}
        title={t(`rs.status_${remote.status}`, { defaultValue: remote.status })}
      >
        <ExpandToggle
          expanded={expanded}
          onToggle={() => setExpanded(v => !v)}
          label={expanded ? t('common.collapse') : t('common.expand')}
        />
        <RouterLink
          to={linkFor(remote.id, '')}
          className={`flex-1 min-w-0 flex items-center gap-1 self-stretch -my-2 py-2 pr-3 -mr-3 rounded-full cursor-pointer ${FOCUS_RING}`}
        >
          <span className="relative shrink-0">
            <Server size={20} style={{ color: isRootActive ? '#1a73e8' : '#5f6368' }} />
            <span
              className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-white"
              style={{ backgroundColor: REMOTE_STATUS_COLOR[remote.status] }}
            />
          </span>
          <span className="text-sm truncate ml-1 flex-1" style={{ color: isRootActive ? 'var(--color-text-nav-active)' : 'var(--color-text-nav)' }}>
            {remote.name}
          </span>
        </RouterLink>
      </div>
      {expanded && (
        <div className="pl-4">
          {dirs.map(d => (
            <RemoteTreeNode
              key={d.path} remoteId={remote.id} entry={d} depth={0}
              activeRemoteId={activeRemoteId} activePath={activePath} linkFor={linkFor}
            />
          ))}
          {data && dirs.length === 0 && (
            <p className="text-xs text-text-tertiary italic py-1 pl-6">{t('common.empty')}</p>
          )}
        </div>
      )}
    </div>
  )
}
export { RemoteSection }

function ModuleTreeNode({
  source, moduleId, mountKey, folder, depth, activePath, linkFor,
}: {
  source: MountSource
  moduleId: string
  mountKey: string
  folder: MountFolder
  depth: number
  activePath: string | null
  /** Builds the real href of a mount folder. */
  linkFor: (path: string) => string
}) {
  const { t } = useTranslation('drive')
  const [expanded, setExpanded] = useState(false)
  const isActive = activePath === folder.id

  const { data } = useQuery({
    queryKey: ['module-mount', moduleId, mountKey, folder.id],
    queryFn:  () => source.list(folder.id),
    enabled:  expanded,
    retry:    false,
  })
  const childDirs = data?.folders ?? []

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 rounded-full cursor-pointer select-none
          ${isActive ? 'bg-primary-light' : ''}`}
        style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: '8px' }}
        {...(isActive ? {} : hoverBg(ROW_HOVER))}
      >
        <ExpandToggle
          expanded={expanded}
          onToggle={() => setExpanded(v => !v)}
          label={expanded ? t('common.collapse') : t('common.expand')}
        />
        <RouterLink
          to={linkFor(folder.id)}
          className={`flex-1 min-w-0 flex items-center gap-1 self-stretch -my-1 py-1 pr-2 -mr-2 rounded-full cursor-pointer ${FOCUS_RING}`}
        >
          <FolderIcon size={15} className="shrink-0" style={{ color: isActive ? '#1a73e8' : '#5f6368' }} fill="currentColor" />
          <span className="text-sm truncate ml-1 flex-1" style={{ color: isActive ? 'var(--color-text-nav-active)' : 'var(--color-text-nav)' }}>
            {folder.name}
          </span>
        </RouterLink>
      </div>
      {expanded && childDirs.map(child => (
        <ModuleTreeNode
          key={child.id} source={source} moduleId={moduleId} mountKey={mountKey}
          folder={child} depth={depth + 1} activePath={activePath} linkFor={linkFor}
        />
      ))}
    </div>
  )
}
export { ModuleTreeNode }

function ModuleMountSection({
  moduleId, mountKey, name, isActiveMount, activePath, linkFor, onHeaderContextMenu,
}: {
  moduleId: string
  mountKey: string
  name: string
  isActiveMount: boolean
  activePath: string
  /** Builds the real href of a mount folder ('' = the mount root). */
  linkFor: (path: string) => string
  onHeaderContextMenu?: (e: React.MouseEvent) => void
}) {
  const { t } = useTranslation('drive')
  const [expanded, setExpanded] = useState(false)
  const source = useMemo(
    () => ModuleServiceRegistry.call<MountSource>(moduleId, 'getStorageSource', mountKey),
    [moduleId, mountKey],
  )
  const isRootActive = isActiveMount && activePath === ''

  const { data } = useQuery({
    queryKey: ['module-mount', moduleId, mountKey, ''],
    queryFn:  () => source!.list(''),
    enabled:  expanded && !!source,
    retry:    false,
  })
  const dirs = data?.folders ?? []

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-3 py-2 rounded-full cursor-pointer select-none
          ${isRootActive ? 'bg-primary-light' : ''}`}
        {...(isRootActive ? {} : hoverBg(ROW_HOVER))}
        onContextMenu={onHeaderContextMenu}
      >
        <ExpandToggle
          expanded={expanded}
          onToggle={() => setExpanded(v => !v)}
          label={expanded ? t('common.collapse') : t('common.expand')}
        />
        <RouterLink
          to={linkFor('')}
          className={`flex-1 min-w-0 flex items-center gap-1 self-stretch -my-2 py-2 pr-3 -mr-3 rounded-full cursor-pointer ${FOCUS_RING}`}
        >
          <Cloud size={20} className="shrink-0" style={{ color: isRootActive ? '#1a73e8' : '#5f6368' }} />
          <span className="text-sm truncate ml-1 flex-1" style={{ color: isRootActive ? 'var(--color-text-nav-active)' : 'var(--color-text-nav)' }}>
            {name}
          </span>
        </RouterLink>
      </div>
      {expanded && source && (
        <div className="pl-4">
          {dirs.map(d => (
            <ModuleTreeNode
              key={d.id} source={source} moduleId={moduleId} mountKey={mountKey}
              folder={d} depth={0} activePath={activePath} linkFor={linkFor}
            />
          ))}
          {data && dirs.length === 0 && (
            <p className="text-xs text-text-tertiary italic py-1 pl-6">{t('common.empty')}</p>
          )}
        </div>
      )}
    </div>
  )
}
export { ModuleMountSection }

function NavItem({
  icon, label, isActive, to,
}: {
  icon: React.ReactNode
  label: string
  isActive: boolean
  to: string
}) {
  return (
    <RouterLink
      to={to}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-full text-sm
        transition-colors text-left select-none cursor-pointer ${FOCUS_RING}
        ${isActive ? 'bg-primary-light' : ''}`}
      {...(isActive ? {} : hoverBg(ROW_HOVER))}
    >
      <span className="flex-shrink-0" style={{ color: isActive ? '#1a73e8' : '#5f6368' }}>
        {icon}
      </span>
      <span className="truncate flex-1" style={{ color: isActive ? 'var(--color-text-nav-active)' : 'var(--color-text-nav)' }}>
        {label}
      </span>
    </RouterLink>
  )
}
export { NavItem }

export function Part1({ s, s_color, deleteSavedSearch }: { s: NonNullable<FilesTreeSidebar['rows_saved_searches']>[number]['s']; s_color: string; deleteSavedSearch: NonNullable<FilesTreeSidebar['deleteSavedSearch']> }) {
  return (
    <div
                    key={s.id}
                    className="group w-full flex items-center gap-3 px-3 py-2 rounded-full text-sm text-left select-none"
                    {...hoverBg(ROW_HOVER)}
                  >
                    {/* Addressable view, no route of its own → real hash link. */}
                    <RouterLink
                      to={hashTo('search', s.id)}
                      className={`flex items-center gap-3 flex-1 min-w-0 self-stretch -my-2 py-2 pr-3 -mr-3 rounded-full cursor-pointer ${FOCUS_RING}`}
                    >
                      <Search size={18} className="flex-shrink-0" style={{ color: s.color ? tagColorHex(s_color) : '#5f6368' }} />
                      <span className="truncate flex-1" style={{ color: 'var(--color-text-nav)' }}>{s.name}</span>
                    </RouterLink>
                    <a
                      href="#"
                      role="button"
                      onClick={e => { e.preventDefault(); e.stopPropagation(); void deleteSavedSearch(s.id) }}
                      onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); void deleteSavedSearch(s.id) } }}
                      className={`opacity-0 group-hover:opacity-100 p-0.5 rounded text-danger transition-opacity cursor-pointer ${FOCUS_RING}`}
                      {...hoverBg('var(--color-danger-light)')}
                      title="Supprimer la recherche"
                    >
                      <X size={14} />
                    </a>
                  </div>
  )
}

export function Part2({ ctx, setCtx }: { ctx: NonNullable<FilesTreeSidebar['ctx']>; setCtx: NonNullable<FilesTreeSidebar['setCtx']> }) {
  return (
    <MenuDropdown items={ctx.items} pos={{ top: ctx.y, left: ctx.x }} onClose={() => setCtx(null)} />
  )
}
