// Central store for the drive's cross-cutting extras: colored tags (+ their
// item assignments), cooperative file locks, and saved searches. Loaded once
// and kept in sync locally as the user mutates things, so cards can paint
// badges without per-item fetches.
import { create } from 'zustand'
import { api } from '@kubuno/sdk'

export interface Tag {
  id:         string
  name:       string
  color:      string
  item_count: number
}

interface TagAssignment {
  tag_id:  string
  item_id: string
  kind:    'file' | 'folder'
}

export interface LockInfo {
  file_id:        string
  locked_by:      string
  locked_by_name: string | null
  reason:         string | null
  created_at:     string
}

export interface SavedSearch {
  id:       string
  name:     string
  query:    string
  filters:  Record<string, unknown>
  icon:     string | null
  color:    string | null
  position: number
}

/** Named tag palette → hex. Shared by every badge/picker in the UI. */
export const TAG_COLORS: Record<string, string> = {
  gray:   '#6b7280',
  red:    '#ef4444',
  orange: '#f97316',
  amber:  '#f59e0b',
  green:  '#22c55e',
  teal:   '#14b8a6',
  blue:   '#3b82f6',
  indigo: '#6366f1',
  purple: '#a855f7',
  pink:   '#ec4899',
}

export function tagColorHex(color: string): string {
  return TAG_COLORS[color] ?? (color.startsWith('#') ? color : TAG_COLORS.gray)
}

interface DriveExtrasState {
  tags:          Tag[]
  /** itemId (file or folder) → tagIds */
  assignments:   Record<string, string[]>
  /** fileId → lock */
  locks:         Record<string, LockInfo>
  savedSearches: SavedSearch[]
  loaded:        boolean
  /** Which global tool dialog is open (duplicates / storage overview). */
  tool:          'duplicates' | 'insights' | null
  openTool:      (t: 'duplicates' | 'insights') => void
  closeTool:     () => void

  loadAll:           () => Promise<void>
  loadTags:          () => Promise<void>
  loadLocks:         () => Promise<void>
  loadSavedSearches: () => Promise<void>

  createTag:   (name: string, color: string) => Promise<void>
  updateTag:   (id: string, patch: { name?: string; color?: string }) => Promise<void>
  deleteTag:   (id: string) => Promise<void>
  toggleTag:   (kind: 'file' | 'folder', itemId: string, tagId: string) => Promise<void>
  tagsForItem: (itemId: string) => Tag[]

  lockFile:   (fileId: string, reason?: string) => Promise<void>
  unlockFile: (fileId: string) => Promise<void>
  isLocked:   (fileId: string) => boolean

  createSavedSearch: (s: { name: string; query: string; filters: Record<string, unknown>; icon?: string; color?: string }) => Promise<void>
  deleteSavedSearch: (id: string) => Promise<void>
}

function indexAssignments(list: TagAssignment[]): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const a of list) {
    ;(map[a.item_id] ||= []).push(a.tag_id)
  }
  return map
}

export const useDriveExtras = create<DriveExtrasState>((set, get) => ({
  tags:          [],
  assignments:   {},
  locks:         {},
  savedSearches: [],
  loaded:        false,
  tool:          null,

  openTool:  (t) => set({ tool: t }),
  closeTool: () => set({ tool: null }),

  async loadAll() {
    await Promise.all([get().loadTags(), get().loadLocks(), get().loadSavedSearches()])
    set({ loaded: true })
  },

  async loadTags() {
    const res = await api.get<{ tags: Tag[]; assignments: TagAssignment[] }>('/drive/tags')
    set({ tags: res.data.tags ?? [], assignments: indexAssignments(res.data.assignments ?? []) })
  },

  async loadLocks() {
    const res = await api.get<{ locks: LockInfo[] }>('/drive/locks')
    const map: Record<string, LockInfo> = {}
    for (const l of res.data.locks ?? []) map[l.file_id] = l
    set({ locks: map })
  },

  async loadSavedSearches() {
    const res = await api.get<{ searches: SavedSearch[] }>('/drive/saved-searches')
    set({ savedSearches: res.data.searches ?? [] })
  },

  async createTag(name, color) {
    await api.post('/drive/tags', { name, color })
    await get().loadTags()
  },

  async updateTag(id, patch) {
    await api.patch(`/drive/tags/${id}`, patch)
    await get().loadTags()
  },

  async deleteTag(id) {
    await api.delete(`/drive/tags/${id}`)
    // Drop the tag and every assignment referencing it.
    set((s) => {
      const assignments: Record<string, string[]> = {}
      for (const [itemId, ids] of Object.entries(s.assignments)) {
        const kept = ids.filter((t) => t !== id)
        if (kept.length) assignments[itemId] = kept
      }
      return { tags: s.tags.filter((t) => t.id !== id), assignments }
    })
  },

  async toggleTag(kind, itemId, tagId) {
    const current = get().assignments[itemId] ?? []
    const has = current.includes(tagId)
    const base = kind === 'folder' ? `/drive/folders/${itemId}` : `/drive/${itemId}`
    if (has) {
      await api.delete(`${base}/tags/${tagId}`)
    } else {
      await api.post(`${base}/tags`, { tag_id: tagId })
    }
    set((s) => {
      const ids = new Set(s.assignments[itemId] ?? [])
      if (has) ids.delete(tagId)
      else ids.add(tagId)
      const next = { ...s.assignments }
      if (ids.size) next[itemId] = Array.from(ids)
      else delete next[itemId]
      return { assignments: next }
    })
  },

  tagsForItem(itemId) {
    const ids = get().assignments[itemId] ?? []
    if (!ids.length) return []
    const byId = new Map(get().tags.map((t) => [t.id, t]))
    return ids.map((id) => byId.get(id)).filter((t): t is Tag => !!t)
  },

  async lockFile(fileId, reason) {
    const res = await api.post<{ lock: LockInfo }>(`/drive/${fileId}/lock`, { reason: reason ?? null })
    set((s) => ({ locks: { ...s.locks, [fileId]: res.data.lock } }))
  },

  async unlockFile(fileId) {
    await api.delete(`/drive/${fileId}/lock`)
    set((s) => {
      const next = { ...s.locks }
      delete next[fileId]
      return { locks: next }
    })
  },

  isLocked(fileId) {
    return !!get().locks[fileId]
  },

  async createSavedSearch(s) {
    await api.post('/drive/saved-searches', s)
    await get().loadSavedSearches()
  },

  async deleteSavedSearch(id) {
    await api.delete(`/drive/saved-searches/${id}`)
    set((st) => ({ savedSearches: st.savedSearches.filter((x) => x.id !== id) }))
  },
}))
