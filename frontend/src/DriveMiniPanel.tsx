import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Clock, Star } from 'lucide-react'
import { Spinner } from '@ui'
import { filesApi, recentApi, getFileIcon, formatSize, type FileItem } from '@kubuno/drive'

/**
 * Drive side panel — reach a file without leaving what you are writing.
 *
 * Two short lists, no browsing: recents (the shared open-log every app records
 * into) and starred. A folder tree here would be a worse copy of the module,
 * which is one click away through the panel header.
 */
export default function DriveMiniPanel() {
  const navigate = useNavigate()

  const { data: recent = [], isLoading } = useQuery({
    queryKey: ['drive-mini-recent'],
    queryFn:  () => recentApi.list({ limit: 8 }),
  })
  const { data: starred = [] } = useQuery({
    queryKey: ['drive-mini-starred'],
    /* Positional signature — and only 5 parameters in the PUBLISHED @kubuno/drive
     * types, which lag the core source. Slicing here avoids making this panel wait
     * on a republication of the package. */
    queryFn:  () => filesApi.listFiles(null, true).then(r => r.files.slice(0, 8)),
  })

  const open = (f: { id: string }) => navigate(`/drive?preview=${f.id}`)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      {isLoading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : (
        <div className="space-y-4">
          <Section icon={<Clock size={12} />} title="Récents" empty="Aucun fichier ouvert récemment.">
            {recent.map(f => <Row key={f.id} file={f} onClick={() => open(f)} />)}
          </Section>
          {starred.length > 0 && (
            <Section icon={<Star size={12} />} title="Étoilés">
              {starred.map(f => <Row key={f.id} file={f} onClick={() => open(f)} />)}
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

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
