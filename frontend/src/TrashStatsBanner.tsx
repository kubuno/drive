import { useState, useEffect } from 'react'
import { Trash2, Clock } from 'lucide-react'
import { api } from '@kubuno/sdk'
import { formatSize } from '@kubuno/drive'

interface TrashStats {
  file_count:     number
  size_bytes:     number
  folder_count:   number
  retention_days: number
}

/** Info banner shown atop the Trash view: item counts, size, auto-purge window. */
export default function TrashStatsBanner() {
  const [stats, setStats] = useState<TrashStats | null>(null)

  useEffect(() => {
    let alive = true
    api.get<TrashStats>('/drive/trash/stats')
      .then((r) => { if (alive) setStats(r.data) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  if (!stats || (stats.file_count === 0 && stats.folder_count === 0)) return null

  const files = `${stats.file_count} fichier${stats.file_count > 1 ? 's' : ''}`
  const folders = stats.folder_count > 0
    ? ` · ${stats.folder_count} dossier${stats.folder_count > 1 ? 's' : ''}`
    : ''

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-surface-1 border border-border text-sm">
      <Trash2 size={16} className="text-text-tertiary shrink-0" />
      <span className="text-text-secondary">{files}{folders} · {formatSize(stats.size_bytes)}</span>
      <span className="ml-auto flex items-center gap-1.5 text-text-tertiary text-xs">
        <Clock size={13} />
        Suppression définitive après {stats.retention_days} jours
      </span>
    </div>
  )
}
