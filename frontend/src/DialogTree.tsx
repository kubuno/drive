import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Folder as FolderIcon, HardDrive, Server } from 'lucide-react'
import { filesApi, FolderGlyph, type Folder, type RemoteEntry } from '@kubuno/drive'

// Folder tree of the CURRENTLY SELECTED storage, shown on the left of the file
// dialogs (open / save / folder picker). It drives the dialog's selection: clicking
// a node jumps the dialog there (the dialog rebuilds its breadcrumb). Self-contained
// (no router / context menus), unlike the app's FilesTreeSidebar.

interface Props {
  /** null = local Drive ; otherwise a remote mount id. */
  sourceId:           string | null
  rootLabel:          string
  /** Highlight: current local folder (null = root). */
  selectedFolderId:   string | null
  /** Highlight: current remote path ('' = root). */
  selectedRemotePath: string
  onPickLocal:        (folderId: string | null) => void
  onPickRemote:       (path: string) => void
}

// ── Local (Drive) nodes ─────────────────────────────────────────────────────────

function LocalNode({
  folder, depth, selectedFolderId, onPick,
}: {
  folder: Folder
  depth: number
  selectedFolderId: string | null
  onPick: (id: string | null) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isActive = selectedFolderId === folder.id
  const { data } = useQuery({
    queryKey: ['dialog-tree-children', folder.id],
    queryFn:  () => filesApi.listFolders(folder.id),
    enabled:  expanded,
    staleTime: 10_000,
  })
  const children = data?.folders ?? []

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 pr-2 rounded-lg cursor-pointer select-none ${isActive ? 'bg-primary-light' : 'hover:bg-surface-2'}`}
        style={{ paddingLeft: `${4 + depth * 14}px` }}
        onClick={() => onPick(folder.id)}
      >
        <button
          className="shrink-0 p-0.5 rounded hover:bg-black/10"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
        >
          <ChevronRight size={13} className="text-text-tertiary" />
        </button>
        <FolderGlyph folder={folder} size={14} className="shrink-0" color={isActive ? '#1a73e8' : undefined} />
        <span className="text-xs truncate ml-1 flex-1" style={{ color: isActive ? '#041e49' : '#5f6368', fontWeight: isActive ? 600 : 400 }}>
          {folder.name}
        </span>
      </div>
      {expanded && children.map(c => (
        <LocalNode key={c.id} folder={c} depth={depth + 1} selectedFolderId={selectedFolderId} onPick={onPick} />
      ))}
    </div>
  )
}

function LocalTree({ rootLabel, selectedFolderId, onPick }: {
  rootLabel: string
  selectedFolderId: string | null
  onPick: (id: string | null) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const { data } = useQuery({
    queryKey: ['dialog-tree-children', null],
    queryFn:  () => filesApi.listFolders(null),
    enabled:  expanded,
    staleTime: 10_000,
  })
  const folders = data?.folders ?? []
  const isRootActive = selectedFolderId === null

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 pr-2 rounded-lg cursor-pointer select-none ${isRootActive ? 'bg-primary-light' : 'hover:bg-surface-2'}`}
        style={{ paddingLeft: '4px' }}
        onClick={() => onPick(null)}
      >
        <button
          className="shrink-0 p-0.5 rounded hover:bg-black/10"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
        >
          <ChevronRight size={13} className="text-text-tertiary" />
        </button>
        <HardDrive size={15} className="shrink-0" style={{ color: isRootActive ? '#1a73e8' : '#5f6368' }} />
        <span className="text-xs font-medium truncate ml-1 flex-1" style={{ color: isRootActive ? '#041e49' : '#5f6368' }}>
          {rootLabel}
        </span>
      </div>
      {expanded && folders.map(f => (
        <LocalNode key={f.id} folder={f} depth={1} selectedFolderId={selectedFolderId} onPick={onPick} />
      ))}
    </div>
  )
}

// ── Remote (mount) nodes ─────────────────────────────────────────────────────────

function RemoteNode({
  mountId, entry, depth, selectedRemotePath, onPick,
}: {
  mountId: string
  entry: RemoteEntry
  depth: number
  selectedRemotePath: string
  onPick: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isActive = selectedRemotePath === entry.path
  const { data } = useQuery({
    queryKey: ['dialog-tree-remote', mountId, entry.path],
    queryFn:  () => filesApi.browseRemote(mountId, entry.path),
    enabled:  expanded,
    retry:    false,
  })
  const dirs = (data ?? []).filter(e => e.is_dir)

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 pr-2 rounded-lg cursor-pointer select-none ${isActive ? 'bg-primary-light' : 'hover:bg-surface-2'}`}
        style={{ paddingLeft: `${4 + depth * 14}px` }}
        onClick={() => onPick(entry.path)}
      >
        <button
          className="shrink-0 p-0.5 rounded hover:bg-black/10"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
        >
          <ChevronRight size={13} className="text-text-tertiary" />
        </button>
        <FolderIcon size={14} className="shrink-0" style={{ color: isActive ? '#1a73e8' : '#5f6368' }} />
        <span className="text-xs truncate ml-1 flex-1" style={{ color: isActive ? '#041e49' : '#5f6368', fontWeight: isActive ? 600 : 400 }}>
          {entry.name}
        </span>
      </div>
      {expanded && dirs.map(d => (
        <RemoteNode key={d.path} mountId={mountId} entry={d} depth={depth + 1} selectedRemotePath={selectedRemotePath} onPick={onPick} />
      ))}
    </div>
  )
}

function RemoteTree({ mountId, rootLabel, selectedRemotePath, onPick }: {
  mountId: string
  rootLabel: string
  selectedRemotePath: string
  onPick: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const { data } = useQuery({
    queryKey: ['dialog-tree-remote', mountId, ''],
    queryFn:  () => filesApi.browseRemote(mountId, ''),
    enabled:  expanded,
    retry:    false,
  })
  const dirs = (data ?? []).filter(e => e.is_dir)
  const isRootActive = selectedRemotePath === ''

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 pr-2 rounded-lg cursor-pointer select-none ${isRootActive ? 'bg-primary-light' : 'hover:bg-surface-2'}`}
        style={{ paddingLeft: '4px' }}
        onClick={() => onPick('')}
      >
        <button
          className="shrink-0 p-0.5 rounded hover:bg-black/10"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
        >
          <ChevronRight size={13} className="text-text-tertiary" />
        </button>
        <Server size={15} className="shrink-0" style={{ color: isRootActive ? '#1a73e8' : '#5f6368' }} />
        <span className="text-xs font-medium truncate ml-1 flex-1" style={{ color: isRootActive ? '#041e49' : '#5f6368' }}>
          {rootLabel}
        </span>
      </div>
      {expanded && dirs.map(d => (
        <RemoteNode key={d.path} mountId={mountId} entry={d} depth={1} selectedRemotePath={selectedRemotePath} onPick={onPick} />
      ))}
    </div>
  )
}

// ── Public component ─────────────────────────────────────────────────────────────

export default function DialogTree({
  sourceId, rootLabel, selectedFolderId, selectedRemotePath, onPickLocal, onPickRemote,
}: Props) {
  return (
    <div className="w-52 flex-shrink-0 border-r border-border bg-surface-1 overflow-y-auto p-2">
      {sourceId === null ? (
        <LocalTree rootLabel={rootLabel} selectedFolderId={selectedFolderId} onPick={onPickLocal} />
      ) : (
        <RemoteTree mountId={sourceId} rootLabel={rootLabel} selectedRemotePath={selectedRemotePath} onPick={onPickRemote} />
      )}
    </div>
  )
}
