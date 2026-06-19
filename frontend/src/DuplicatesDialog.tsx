import { useState, useEffect, useCallback } from 'react'
import { api } from '@kubuno/sdk'
import { formatSize } from '@kubuno/drive'
import { Button } from '@ui'
import { Copy, Trash2, X, Loader2, FileText, CheckCircle2 } from 'lucide-react'

interface DupFile {
  id:         string
  name:       string
  size_bytes: number
  mime_type:  string
  folder_id:  string | null
  updated_at: string
}

interface DupGroup {
  content_hash: string
  count:        number
  wasted_bytes: number
  files:        DupFile[]
}

interface DuplicatesResponse {
  groups:       DupGroup[]
  total_wasted: number
}

interface Props {
  onClose:    () => void
  onChanged?: () => void // called after deletion to refresh the parent listing
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR')
}

export default function DuplicatesDialog({ onClose, onChanged }: Props) {
  const [groups,      setGroups]      = useState<DupGroup[]>([])
  const [totalWasted, setTotalWasted] = useState(0)
  const [loading,     setLoading]     = useState(true)
  // Per-file deletion state, keyed by file id.
  const [deleting,    setDeleting]    = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .get<DuplicatesResponse>('/drive/duplicates')
      .then(({ data }) => {
        if (cancelled) return
        setGroups(data.groups)
        setTotalWasted(data.total_wasted)
      })
      .catch(() => {
        if (cancelled) return
        setGroups([])
        setTotalWasted(0)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Remove a set of file ids from local state, dropping any group that ends up
  // with a single (or no) remaining file, and recomputing the wasted total.
  const removeFiles = useCallback((ids: Set<string>) => {
    setGroups(prev => {
      const next: DupGroup[] = []
      for (const g of prev) {
        const remaining = g.files.filter(f => !ids.has(f.id))
        if (remaining.length <= 1) continue
        next.push({ ...g, files: remaining, count: remaining.length })
      }
      return next
    })
    setTotalWasted(prev => {
      let removed = 0
      for (const g of groups) {
        for (const f of g.files) {
          if (ids.has(f.id)) removed += f.size_bytes
        }
      }
      return Math.max(0, prev - removed)
    })
  }, [groups])

  const trashFile = useCallback(async (file: DupFile) => {
    setDeleting(prev => ({ ...prev, [file.id]: true }))
    try {
      await api.post(`/drive/${file.id}/trash`)
      removeFiles(new Set([file.id]))
      onChanged?.()
    } finally {
      setDeleting(prev => {
        const { [file.id]: _removed, ...rest } = prev
        return rest
      })
    }
  }, [removeFiles, onChanged])

  const trashGroupDuplicates = useCallback(async (group: DupGroup) => {
    const targets = group.files.slice(1)
    if (targets.length === 0) return
    setDeleting(prev => {
      const next = { ...prev }
      for (const f of targets) next[f.id] = true
      return next
    })
    const done = new Set<string>()
    try {
      for (const f of targets) {
        await api.post(`/drive/${f.id}/trash`)
        done.add(f.id)
      }
    } finally {
      if (done.size > 0) {
        removeFiles(done)
        onChanged?.()
      }
      setDeleting(prev => {
        const next = { ...prev }
        for (const f of targets) delete next[f.id]
        return next
      })
    }
  }, [removeFiles, onChanged])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 p-6 max-h-[85vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Copy size={20} className="text-primary" />
            <h2 className="text-lg font-semibold text-text-primary">Fichiers en double</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-surface-2 text-text-secondary transition-colors"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Récap */}
        {!loading && groups.length > 0 && (
          <div className="mb-4 rounded-lg bg-surface-1 border border-border px-3 py-2 text-sm text-text-secondary">
            {groups.length} groupe{groups.length > 1 ? 's' : ''} ·{' '}
            <span className="font-medium text-text-primary">{formatSize(totalWasted)}</span> récupérable{totalWasted > 0 ? 's' : ''}
          </div>
        )}

        {/* Contenu */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-text-tertiary" />
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary gap-2">
            <CheckCircle2 size={36} strokeWidth={1.5} className="text-primary" />
            <p className="text-sm">Aucun doublon détecté 🎉</p>
          </div>
        ) : (
          <div>
            {groups.map(group => (
              <div key={group.content_hash} className="border border-border rounded-lg p-3 mb-3">
                <div className="space-y-1">
                  {group.files.map((file, idx) => {
                    const isOriginal = idx === 0
                    const isDeleting = deleting[file.id] === true
                    return (
                      <div
                        key={file.id}
                        className="flex items-center gap-3 px-2 py-1.5 rounded-lg bg-surface-1"
                      >
                        <FileText size={16} className="text-text-tertiary flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-text-primary truncate">{file.name}</p>
                          <p className="text-xs text-text-tertiary">
                            {formatSize(file.size_bytes)} · {fmtDate(file.updated_at)}
                          </p>
                        </div>
                        {isOriginal ? (
                          <span className="flex items-center gap-1 text-xs font-medium text-primary bg-surface-2 rounded-full px-2 py-0.5 flex-shrink-0">
                            <CheckCircle2 size={12} />
                            Conservé
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={isDeleting}
                            disabled={isDeleting}
                            onClick={() => void trashFile(file)}
                            className="text-danger flex-shrink-0"
                          >
                            <Trash2 size={14} />
                            Mettre à la corbeille
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>

                {group.files.length > 1 && (
                  <div className="flex justify-end mt-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void trashGroupDuplicates(group)}
                      disabled={group.files.slice(1).every(f => deleting[f.id] === true)}
                    >
                      <Trash2 size={14} />
                      Supprimer les doublons
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pied de page */}
        <div className="flex justify-end pt-2">
          <Button variant="secondary" onClick={onClose}>Fermer</Button>
        </div>
      </div>
    </div>
  )
}
