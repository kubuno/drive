import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import type { Folder, FolderAncestor } from '@kubuno/drive'

interface BreadcrumbProps {
  folder:      Folder | null
  ancestors:   FolderAncestor[]
  pageTitle:   string
  onNavigate:  (id: string | null) => void
}

export default function Breadcrumb({ folder, ancestors, pageTitle, onNavigate }: BreadcrumbProps) {
  const { t } = useTranslation('drive')
  // Special view (Trash, Recent…) → plain title, not clickable.
  if (!folder) {
    return (
      <h1 className="text-xl font-medium text-text-primary leading-tight">{pageTitle}</h1>
    )
  }

  // Folder view → full breadcrumb trail.
  return (
    <nav className="flex items-center gap-0.5 flex-wrap" aria-label={t('app.breadcrumb')}>
      {/* Root */}
      <button
        onClick={() => onNavigate(null)}
        className="text-xl font-medium text-text-secondary hover:text-primary transition-colors leading-tight"
      >
        {t('nav.my_files')}
      </button>

      {/* Intermediate ancestors */}
      {ancestors.map((anc) => (
        <span key={anc.id} className="flex items-center gap-0.5">
          <ChevronRight size={16} className="text-text-tertiary flex-shrink-0" />
          <button
            onClick={() => onNavigate(anc.id)}
            className="text-xl font-medium text-text-secondary hover:text-primary transition-colors leading-tight"
          >
            {anc.name}
          </button>
        </span>
      ))}

      {/* Current folder — not clickable */}
      <span className="flex items-center gap-0.5">
        <ChevronRight size={16} className="text-text-tertiary flex-shrink-0" />
        <span className="text-xl font-medium text-text-primary leading-tight">
          {folder.name}
        </span>
      </span>
    </nav>
  )
}
