import { useState, useEffect } from 'react'
import {
  X,
  Image,
  Video,
  Music,
  FileText,
  Archive,
  File,
  HardDrive,
  Loader2,
} from 'lucide-react'
import { api } from '@kubuno/sdk'
import { formatSize } from '@kubuno/drive'
import { Button } from '@ui'

interface Props {
  onClose: () => void
  onOpenFile?: (id: string) => void
}

interface CategoryStat {
  category: string
  count: number
  size: number
}

interface BigFile {
  id: string
  name: string
  size_bytes: number
  mime_type: string
}

interface Overview {
  categories: CategoryStat[]
  total_files: number
  total_folders: number
  trashed_files: number
  largest: BigFile[]
}

// Known categories in their canonical render order.
const CATEGORY_ORDER = ['image', 'video', 'audio', 'document', 'archive', 'other'] as const
type KnownCategory = (typeof CATEGORY_ORDER)[number]

const CATEGORY_LABELS: Record<KnownCategory, string> = {
  image: 'Images',
  video: 'Vidéos',
  audio: 'Audio',
  document: 'Documents',
  archive: 'Archives',
  other: 'Autres',
}

const CATEGORY_ICONS: Record<KnownCategory, typeof Image> = {
  image: Image,
  video: Video,
  audio: Music,
  document: FileText,
  archive: Archive,
  other: File,
}

function labelFor(category: string): string {
  return (CATEGORY_LABELS as Record<string, string | undefined>)[category] ?? 'Autres'
}

function iconFor(category: string): typeof Image {
  return (CATEGORY_ICONS as Record<string, typeof Image | undefined>)[category] ?? File
}

export default function StorageInsightsDialog({ onClose, onOpenFile }: Props) {
  const [loading, setLoading] = useState(true)
  const [overview, setOverview] = useState<Overview | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    api
      .get<Overview>('/drive/stats/overview')
      .then(({ data }) => {
        if (active) setOverview(data)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const sortedCategories = overview
    ? [...overview.categories].sort((a, b) => b.size - a.size)
    : []
  const maxSize = Math.max(...sortedCategories.map((c) => c.size), 1)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-xl mx-4 p-6 max-h-[85vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <HardDrive size={20} className="text-primary" />
            <h2 className="text-lg font-semibold text-text-primary">
              Vue d&apos;ensemble du stockage
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-surface-2 text-text-secondary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {loading || !overview ? (
          <div className="flex items-center justify-center py-16 text-text-secondary">
            <Loader2 size={28} className="animate-spin" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Stat cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-surface-1 rounded-lg p-3 text-center">
                <div className="text-2xl font-semibold text-text-primary">
                  {overview.total_files}
                </div>
                <div className="text-xs text-text-secondary mt-1">Fichiers</div>
              </div>
              <div className="bg-surface-1 rounded-lg p-3 text-center">
                <div className="text-2xl font-semibold text-text-primary">
                  {overview.total_folders}
                </div>
                <div className="text-xs text-text-secondary mt-1">Dossiers</div>
              </div>
              <div className="bg-surface-1 rounded-lg p-3 text-center">
                <div className="text-2xl font-semibold text-text-primary">
                  {overview.trashed_files}
                </div>
                <div className="text-xs text-text-secondary mt-1">Corbeille</div>
              </div>
            </div>

            {/* Breakdown by type */}
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">
                Répartition par type
              </h3>
              <div className="space-y-3">
                {sortedCategories.map((cat) => {
                  const Icon = iconFor(cat.category)
                  const pct = (cat.size / maxSize) * 100
                  return (
                    <div key={cat.category} className="flex items-center gap-3">
                      <Icon size={18} className="text-text-secondary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-text-primary truncate">
                            {labelFor(cat.category)}
                          </span>
                          <span className="text-xs text-text-tertiary shrink-0 ml-2">
                            {cat.count} · {formatSize(cat.size)}
                          </span>
                        </div>
                        <div className="bg-surface-2 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-primary h-2 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Largest files */}
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">
                Plus gros fichiers
              </h3>
              <div className="space-y-1">
                {overview.largest.map((f) => (
                  <div
                    key={f.id}
                    onClick={onOpenFile ? () => onOpenFile(f.id) : undefined}
                    className={`flex items-center justify-between gap-3 px-2 py-1.5 rounded-lg ${
                      onOpenFile ? 'cursor-pointer hover:bg-surface-1' : ''
                    }`}
                  >
                    <span className="text-sm text-text-primary truncate">{f.name}</span>
                    <span className="text-xs text-text-tertiary shrink-0">
                      {formatSize(f.size_bytes)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end mt-6">
          <Button variant="secondary" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </div>
  )
}
