import { useTranslation } from 'react-i18next'
import { Camera, Loader2, X } from 'lucide-react'
import type { FileItem, SearchHit } from '@kubuno/drive'
import SearchResultRow from './SearchResultRow'

// ── Similar-image search (results) ────────────────────────────────────────────

export default function ImageSearchResultsView({
  state, onClear, onOpen,
}: {
  state: { name: string; loading: boolean; results: SearchHit[]; total: number }
  onClear: () => void
  onOpen: (file: FileItem) => void
}) {
  const { t } = useTranslation('drive')
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="flex items-center gap-2">
            <Camera size={18} className="text-primary" />
            <h1 className="text-xl font-medium text-text-primary truncate">
              {t('search.similar_to', { defaultValue: 'Images similaires à « {{name}} »', name: state.name })}
            </h1>
          </div>
          <p className="text-sm text-text-secondary mt-0.5">
            {state.loading ? t('app.searching') : t('app.result_count', { count: state.total })}
          </p>
        </div>
        <button onClick={onClear} className="flex items-center gap-2 text-sm text-primary hover:text-primary-hover transition-colors">
          <X size={16} /> {t('app.clear_search')}
        </button>
      </div>

      {state.loading ? (
        <div className="flex items-center gap-2 text-text-secondary text-sm py-16 justify-center">
          <Loader2 size={18} className="animate-spin" />
          {t('app.searching')}
        </div>
      ) : state.results.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <Camera size={52} className="text-text-tertiary" />
          <p className="text-text-secondary text-sm">{t('search.no_similar', { defaultValue: 'Aucune image similaire trouvée' })}</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {state.results.map(file => <SearchResultRow key={file.id} file={file} onOpen={onOpen} />)}
        </div>
      )}
    </div>
  )
}
