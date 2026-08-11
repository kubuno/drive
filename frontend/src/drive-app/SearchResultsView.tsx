import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Bookmark, ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-react'
import { filesApi, type FileItem, type FilesSearchFilters } from '@kubuno/drive'
import { prompt } from '@kubuno/sdk'
import { useDriveExtras } from '../driveExtras'
import { isPreviewable } from './fileKinds'
import SearchResultRow from './SearchResultRow'

// ── SearchResultsView ─────────────────────────────────────────────────────────

export default function SearchResultsView({
  searchQuery,
  searchFilters,
  onClear,
  onOpen,
  onResults,
}: {
  searchQuery: string
  searchFilters: FilesSearchFilters
  onClear: () => void
  onOpen: (file: FileItem) => void
  /** Reports the current previewable results so the previewer can navigate them. */
  onResults?: (files: FileItem[]) => void
}) {
  const { t } = useTranslation('drive')
  const PAGE_SIZE = 20

  // Debounce the query (250 ms): one search per typing pause, not per keystroke.
  const [debouncedQ, setDebouncedQ] = useState(searchQuery)
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(searchQuery), 250)
    return () => clearTimeout(id)
  }, [searchQuery])

  // Type tabs (All / Images / Videos) — they drive the type filter.
  const [tab, setTab] = useState<'all' | 'image' | 'video'>('all')
  const [page, setPage] = useState(0)

  const hasCriteria =
    debouncedQ.trim().length > 0 ||
    searchFilters.itemName.trim().length > 0 ||
    searchFilters.containsWords.trim().length > 0

  // The tab takes precedence over the filter panel's type (All = panel type).
  const effFilters: FilesSearchFilters = useMemo(
    () => ({ ...searchFilters, type: tab === 'all' ? searchFilters.type : tab }),
    [searchFilters, tab],
  )

  // Reset the page to 0 whenever the query / filters / tab change.
  useEffect(() => { setPage(0) }, [debouncedQ, effFilters])

  const { data, isFetching } = useQuery({
    queryKey: ['files-search', debouncedQ.trim(), effFilters, page],
    queryFn:  () => filesApi.searchFiles(debouncedQ.trim(), effFilters, { limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    enabled:  hasCriteria,
    placeholderData: prev => prev, // keep the previous page while loading
  })

  const results   = data?.results ?? []
  const total     = data?.total ?? 0
  const semantic  = data?.semantic ?? false

  // Report previewable results (this page) upward for ←/→ file navigation.
  useEffect(() => {
    onResults?.((results as unknown as FileItem[]).filter(isPreviewable))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results])
  const isLoading = hasCriteria && isFetching && !data
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const label = searchQuery ? t('app.search_for', { query: searchQuery }) : t('app.search_results')

  const TABS: Array<{ id: 'all' | 'image' | 'video'; label: string }> = [
    { id: 'all',   label: t('search.tab_all', { defaultValue: 'Tous' }) },
    { id: 'image', label: t('search.tab_images', { defaultValue: 'Images' }) },
    { id: 'video', label: t('search.tab_videos', { defaultValue: 'Vidéos' }) },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-medium text-text-primary">{label}</h1>
            {semantic && (
              <span className="text-[10px] uppercase tracking-wide text-primary bg-primary-light px-2 py-0.5 rounded-full">
                {t('search.semantic_on')}
              </span>
            )}
          </div>
          <p className="text-sm text-text-secondary mt-0.5">
            {isLoading ? t('app.searching') : t('app.result_count', { count: total })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              const name = await prompt({
                title: 'Sauvegarder la recherche',
                message: 'Donnez un nom à cette recherche pour la retrouver dans la barre latérale.',
                defaultValue: searchQuery || 'Ma recherche',
                confirmLabel: 'Sauvegarder',
              })
              if (name && name.trim()) {
                try {
                  await useDriveExtras.getState().createSavedSearch({
                    name: name.trim(),
                    query: searchQuery,
                    filters: effFilters as unknown as Record<string, unknown>,
                  })
                } catch { /* ignore */ }
              }
            }}
            className="flex items-center gap-2 text-sm text-text-secondary hover:text-primary transition-colors"
          >
            <Bookmark size={16} />
            Sauvegarder
          </button>
          <button
            onClick={onClear}
            className="flex items-center gap-2 text-sm text-primary hover:text-primary-hover transition-colors"
          >
            <X size={16} />
            {t('app.clear_search')}
          </button>
        </div>
      </div>

      {/* Type tabs */}
      <div className="flex items-center gap-1 border-b border-border mb-4">
        {TABS.map(tb => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === tb.id
                ? 'border-primary text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-text-secondary text-sm py-16 justify-center">
          <Loader2 size={18} className="animate-spin" />
          {t('app.searching')}
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <Search size={52} className="text-text-tertiary" />
          <p className="text-text-secondary text-sm">{t('app.no_results')}</p>
          <p className="text-text-tertiary text-xs">{t('app.no_results_hint')}</p>
        </div>
      ) : (
        <>
          <div className={`divide-y divide-border ${isFetching ? 'opacity-60' : ''}`}>
            {results.map(file => <SearchResultRow key={file.id} file={file} onOpen={onOpen} />)}
          </div>

          {/* Pagination */}
          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-border text-text-secondary hover:bg-surface-1 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={15} /> {t('app.prev', { defaultValue: 'Précédent' })}
              </button>
              <span className="text-sm text-text-secondary">{t('app.page_of', { defaultValue: 'Page {{page}} / {{total}}', page: page + 1, total: pageCount })}</span>
              <button
                onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-border text-text-secondary hover:bg-surface-1 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('app.next', { defaultValue: 'Suivant' })} <ChevronRight size={15} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
