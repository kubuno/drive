/**
 * The parts of `DriveMiniPanel.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { Clock, Star } from "lucide-react"
import { getFileIcon, formatSize, type FileItem } from "@kubuno/drive"
import type { DriveMiniPanel } from './DriveMiniPanel'

function Section({ icon, title, empty, children }: {
  icon: React.ReactNode; title: string; empty?: string; children: React.ReactNode
}) {
  const isEmpty = Array.isArray(children) ? children.length === 0 : !children
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 px-2 uppercase tracking-wide text-text-tertiary"
           style={{ fontSize: 'var(--kb-text-meta)' }}>
        {icon}{title}
      </div>
      {isEmpty && empty
        ? <p className="px-2 text-text-tertiary" style={{ fontSize: 'var(--kb-text-meta)' }}>{empty}</p>
        : <div className="space-y-0.5">{children}</div>}
    </div>
  )
}
export { Section }

function Row({ file, onClick }: { file: FileItem; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={file.name}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-1
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
        {getFileIcon(file.mime_type, file.name)}
      </span>
      <span className="min-w-0 flex-1 truncate text-text-primary" style={{ fontSize: 'var(--kb-text-body)' }}>
        {file.name}
      </span>
      <span className="flex-shrink-0 text-text-tertiary" style={{ fontSize: 'var(--kb-text-meta)' }}>
        {formatSize(file.size_bytes)}
      </span>
    </button>
  )
}
export { Row }

export function Part1({ recent, open }: { recent: NonNullable<DriveMiniPanel['recent']>; open: DriveMiniPanel['open'] }) {
  return (
    <Section icon={<Clock size={12} />} title="Récents" empty="Aucun fichier ouvert récemment.">
                {recent.map(f => <Row key={f.id} file={f} onClick={() => open(f)} />)}
              </Section>
  )
}

export function Part2({ starred, open }: { starred: NonNullable<DriveMiniPanel['starred']>; open: DriveMiniPanel['open'] }) {
  return (
    <Section icon={<Star size={12} />} title="Étoilés">
                  {starred.map(f => <Row key={f.id} file={f} onClick={() => open(f)} />)}
                </Section>
  )
}
