// Shared breadcrumb for the file/folder selector dialogs (open / save / folder picker).
// The first element is a *storage source* dropdown (My Drive + external mounts) so external
// storages read as separate roots — not as folders living inside the local drive. The rest
// mirrors the main Drive breadcrumb: `>` chevrons, clickable ancestors, a bold current crumb.
import { ChevronDown, ChevronRight, HardDrive, Server } from 'lucide-react'
import { MenuDropdown, useMenuDropdown, type MenuItem } from '@ui'

/** A selectable storage: id=null means the local "My Drive", otherwise a remote mount id. */
export interface StorageOpt {
  id:      string | null
  name:    string
  remote?: boolean
}

export interface PathCrumb { name: string }

interface Props {
  sources:         StorageOpt[]
  currentSourceId: string | null
  onSelectSource:  (id: string | null) => void
  /** Path segments inside the current storage (excludes the storage root itself). */
  pathCrumbs:      PathCrumb[]
  onNavigatePath:  (idx: number) => void
}

export default function DialogBreadcrumb({
  sources, currentSourceId, onSelectSource, pathCrumbs, onNavigatePath,
}: Props) {
  const menu    = useMenuDropdown()
  const current = sources.find(s => s.id === currentSourceId) ?? sources[0]
  const multi   = sources.length > 1

  const items: MenuItem[] = sources.map(s => ({
    type:    'action',
    label:   s.name,
    icon:    s.remote ? <Server size={14} /> : <HardDrive size={14} />,
    checked: s.id === currentSourceId,
    onClick: () => onSelectSource(s.id),
  }))

  return (
    <nav className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto" aria-label="breadcrumb">
      {/* Storage source selector */}
      <button
        onClick={multi ? menu.open : undefined}
        disabled={!multi}
        className={`flex items-center gap-1 text-sm font-medium text-text-primary rounded px-1.5 py-1 flex-shrink-0 ${
          multi ? 'hover:bg-surface-2' : 'cursor-default'
        }`}
      >
        {current?.remote
          ? <Server size={13} className="flex-shrink-0 text-primary" />
          : <HardDrive size={13} className="flex-shrink-0 text-text-secondary" />}
        <span className="truncate max-w-[160px]">{current?.name}</span>
        {multi && <ChevronDown size={13} className="flex-shrink-0 text-text-tertiary" />}
      </button>
      {menu.isOpen && menu.pos && (
        <MenuDropdown items={items} pos={menu.pos} onClose={menu.close} minWidth={200} />
      )}

      {/* Path within the current storage */}
      {pathCrumbs.map((c, idx) => {
        const isLast = idx === pathCrumbs.length - 1
        return (
          <span key={idx} className="flex items-center gap-0.5 flex-shrink-0">
            <ChevronRight size={16} className="text-text-tertiary flex-shrink-0" />
            <button
              onClick={() => onNavigatePath(idx)}
              disabled={isLast}
              className={`text-sm font-medium leading-tight rounded px-0.5 transition-colors ${
                isLast ? 'text-text-primary cursor-default' : 'text-text-secondary hover:text-primary'
              }`}
            >
              <span className="truncate max-w-[160px] inline-block align-bottom">{c.name}</span>
            </button>
          </span>
        )
      })}
    </nav>
  )
}
