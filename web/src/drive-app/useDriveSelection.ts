import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { filesApi, useBatchRenameStore, useMarqueeSelection, type BatchRenameItem, type FileItem, type Folder } from '@kubuno/drive'

interface Args {
  orderedIds: string[]
  folders:    Folder[]
  files:      FileItem[]
  trashed:    boolean
  openFile:   (file: FileItem) => void
  navigate:   (id: string | null) => void
}

export interface DriveSelection {
  selectedIds: Set<string>
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>
  cursorId: string | null
  lastSelectedIdxRef: React.RefObject<number>
  handleItemSelect: (id: string, e: React.MouseEvent) => void
  allItemsSelected: boolean
  toggleSelectAll: () => void
  marqueeContainerRef: React.RefObject<HTMLDivElement | null>
  marqueeStyle: ReturnType<typeof useMarqueeSelection>['marqueeStyle']
  preSelectedIds: Set<string>
  onMarqueeDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onMarqueeMove: (e: React.PointerEvent<HTMLDivElement>) => void
  onMarqueeUp: () => void
  onMarqueeCancel: () => void
}

/** Owns the item selection: pointer, marquee and keyboard (Ctrl+A, arrows, F2…). */
export function useDriveSelection({ orderedIds, folders, files, trashed, openFile, navigate }: Args): DriveSelection {
  const qc = useQueryClient()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const lastSelectedIdxRef = useRef<number>(-1)
  // Keyboard navigation cursor (arrow keys move it; Enter opens).
  const [cursorId, setCursorId] = useState<string | null>(null)

  const handleMarqueeSelect = useCallback((ids: Set<string>, additive: boolean) => {
    setSelectedIds(additive ? prev => new Set([...prev, ...ids]) : ids)
  }, [])

  const { containerRef: marqueeContainerRef, marqueeStyle, preSelectedIds,
          onPointerDown: onMarqueeDown, onPointerMove: onMarqueeMove,
          onPointerUp: onMarqueeUp, onPointerCancel: onMarqueeCancel } = useMarqueeSelection(handleMarqueeSelect)

  const allItemsSelected = orderedIds.length > 0 && orderedIds.every(id => selectedIds.has(id))
  const selectAll   = () => setSelectedIds(new Set(orderedIds))
  const toggleSelectAll = () => allItemsSelected ? setSelectedIds(new Set()) : selectAll()

  // Shortcuts: Ctrl/Cmd+A → select all; Escape → clear the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (typing) return
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        if (orderedIds.length === 0) return
        e.preventDefault()
        setSelectedIds(new Set(orderedIds))
      } else if (e.key === 'Escape' && selectedIds.size > 0) {
        setSelectedIds(new Set())
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        // Delete → trash; Shift+Delete → permanent delete. Inside the trash,
        // Delete also deletes permanently. Best-effort (ignores locks).
        e.preventDefault()
        const ids = [...selectedIds]
        const permanent = e.shiftKey || trashed
        const isFolder = (id: string) => folders.some(f => f.id === id)
        void Promise.allSettled(ids.map(id =>
          permanent
            ? (isFolder(id) ? filesApi.deleteFolder(id) : filesApi.deleteFile(id))
            : (isFolder(id) ? filesApi.trashFolder(id) : filesApi.trashFile(id))
        )).then(() => {
          setSelectedIds(new Set())
          qc.invalidateQueries({ queryKey: ['files'] })
          qc.invalidateQueries({ queryKey: ['folders'] })
          qc.invalidateQueries({ queryKey: ['tree-children'] })
        })
      } else if (e.key === 'F2' && selectedIds.size > 0) {
        // F2 → rename (batch rename when several items are selected).
        e.preventDefault()
        const out: BatchRenameItem[] = []
        for (const id of selectedIds) {
          const fo = folders.find(x => x.id === id)
          if (fo) { out.push({ id: fo.id, name: fo.name, type: 'folder' }); continue }
          const fi = files.find(x => x.id === id)
          if (fi) out.push({ id: fi.id, name: fi.name, type: 'file' })
        }
        if (out.length) useBatchRenameStore.getState().start(out)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [orderedIds, selectedIds, folders, files, trashed, qc])

  // Arrow-key navigation: move a cursor across folders+files (any view mode),
  // Enter opens. Left/Right step in the flat order; Up/Down jump to the nearest
  // item on the adjacent visual row (works for grids and single-column lists).
  useEffect(() => {
    const openItem = (id: string) => {
      const folder = folders.find(f => f.id === id)
      if (folder) { if (!trashed) navigate(folder.id); return }
      const file = files.find(f => f.id === id)
      if (file && !trashed) openFile(file)
    }
    const focusCursor = (id: string, additive: boolean) => {
      setCursorId(id)
      setSelectedIds(prev => additive ? new Set([...prev, id]) : new Set([id]))
      lastSelectedIdxRef.current = orderedIds.indexOf(id)
      const el = marqueeContainerRef.current?.querySelector<HTMLElement>(`[data-selectable-id="${CSS.escape(id)}"]`)
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    // Nearest item on the row above/below, by visual geometry.
    const vertical = (id: string, dir: 1 | -1): string | null => {
      const root = marqueeContainerRef.current
      if (!root) return null
      const nodes = [...root.querySelectorAll<HTMLElement>('[data-selectable-id]')]
      const cur = nodes.find(n => n.dataset.selectableId === id)
      if (!cur) return null
      const cr = cur.getBoundingClientRect()
      const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2
      let best: { id: string; dist: number } | null = null
      for (const n of nodes) {
        if (n === cur) continue
        const r = n.getBoundingClientRect()
        const ny = r.top + r.height / 2
        // Must be on a different row in the requested direction.
        if (dir === 1 && r.top <= cr.bottom - 2) continue
        if (dir === -1 && r.bottom >= cr.top + 2) continue
        const nx = r.left + r.width / 2
        const dist = Math.abs(nx - cx) + Math.abs(ny - cy) * 3 // bias toward same column
        const nid = n.dataset.selectableId
        if (nid && (!best || dist < best.dist)) best = { id: nid, dist }
      }
      return best?.id ?? null
    }
    const onKey = (e: KeyboardEvent) => {
      if (orderedIds.length === 0) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      // Anchor movement on the keyboard cursor, falling back to the current
      // selection so arrows continue from the selected object.
      const selectionAnchor = (): string | null => {
        if (selectedIds.size === 0) return null
        const li = lastSelectedIdxRef.current
        if (li >= 0 && li < orderedIds.length && selectedIds.has(orderedIds[li])) return orderedIds[li]
        for (let i = orderedIds.length - 1; i >= 0; i--) if (selectedIds.has(orderedIds[i])) return orderedIds[i]
        return null
      }
      const cur = cursorId && orderedIds.includes(cursorId) ? cursorId : selectionAnchor()
      const idx = cur ? orderedIds.indexOf(cur) : -1
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        focusCursor(orderedIds[idx < 0 ? 0 : Math.min(idx + 1, orderedIds.length - 1)], e.shiftKey)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        focusCursor(orderedIds[idx < 0 ? 0 : Math.max(idx - 1, 0)], e.shiftKey)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = cur ? vertical(cur, 1) : orderedIds[0]
        if (next) focusCursor(next, e.shiftKey)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const next = cur ? vertical(cur, -1) : orderedIds[0]
        if (next) focusCursor(next, e.shiftKey)
      } else if (e.key === 'Enter' && cur) {
        e.preventDefault()
        openItem(cur)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedIds, cursorId, selectedIds, folders, files, trashed])

  const handleItemSelect = useCallback((id: string, e: React.MouseEvent) => {
    const currentIdx = orderedIds.indexOf(id)
    // Keep the keyboard cursor anchored on the clicked item so arrow keys
    // continue from the current selection.
    setCursorId(id)
    if (e.shiftKey && lastSelectedIdxRef.current >= 0) {
      const from = Math.min(lastSelectedIdxRef.current, currentIdx)
      const to   = Math.max(lastSelectedIdxRef.current, currentIdx)
      const range = orderedIds.slice(from, to + 1)
      setSelectedIds(prev => { const next = new Set(prev); range.forEach(r => next.add(r)); return next })
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
      lastSelectedIdxRef.current = currentIdx
    } else {
      setSelectedIds(new Set([id]))
      lastSelectedIdxRef.current = currentIdx
    }
  }, [orderedIds])

  return {
    selectedIds, setSelectedIds,
    cursorId, lastSelectedIdxRef,
    handleItemSelect,
    allItemsSelected, toggleSelectAll,
    marqueeContainerRef, marqueeStyle, preSelectedIds,
    onMarqueeDown, onMarqueeMove, onMarqueeUp, onMarqueeCancel,
  }
}
