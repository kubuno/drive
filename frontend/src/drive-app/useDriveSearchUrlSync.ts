import { useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useFilesStore } from '@kubuno/drive'
import { useSearchStore } from '@kubuno/sdk'
import { SEARCH_PARAM } from './types'

// ── Search persisted in the URL (`search-q`) ─────────────────────────────────
// Goal: after F5, replay the same search. The URL is the source of truth. We
// restore on mount / navigation (URL → state) and mirror every keystroke
// (state → URL), without touching the other parameters (`folder`…).
export function useDriveSearchUrlSync(searchQuery: string) {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlSearchQ = searchParams.get(SEARCH_PARAM) ?? ''

  // Mirrors the query into the shell's search field (controlled seed).
  const seedShellField = useCallback((q: string) => {
    ;(useSearchStore.getState() as { setQuery?: (q: string) => void }).setQuery?.(q)
  }, [])

  // URL → state: restore on mount and on navigation (back/forward).
  useEffect(() => {
    if (urlSearchQ === useFilesStore.getState().searchQuery) return
    useFilesStore.getState().setSearchQuery(urlSearchQ)
    seedShellField(urlSearchQ)
  }, [urlSearchQ, seedShellField])

  // state → URL: every keystroke (or clear) is written to the URL. The very
  // first render is skipped so the URL → state restore can apply without a
  // still-empty state wiping the `search-q` present in the URL.
  const searchUrlFirstRun = useRef(true)
  useEffect(() => {
    if (searchUrlFirstRun.current) { searchUrlFirstRun.current = false; return }
    seedShellField(searchQuery)
    if (searchQuery === urlSearchQ) return
    setSearchParams(prev => {
      const n = new URLSearchParams(prev)
      if (searchQuery.trim()) n.set(SEARCH_PARAM, searchQuery)
      else n.delete(SEARCH_PARAM)
      return n
    }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery])
}
