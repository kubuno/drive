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

/** What the tag mutators need to know about the tagged item (core snapshot). */
export interface TagTarget {
  kind: 'file' | 'folder'
  id:   string
  name: string
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
  toggleTag:   (target: TagTarget, tagId: string) => Promise<void>
  tagsForItem: (itemId: string) => Tag[]

  lockFile:   (fileId: string, reason?: string) => Promise<void>
  unlockFile: (fileId: string) => Promise<void>
  isLocked:   (fileId: string) => boolean

  createSavedSearch: (s: { name: string; query: string; filters: Record<string, unknown>; icon?: string; color?: string }) => Promise<void>
  deleteSavedSearch: (id: string) => Promise<void>
}

// ── Core-backed tags ──────────────────────────────────────────────────────────
// Tags ARE the core's cross-module labels (`/api/v1/labels`): the drive keeps
// its dots/dialog UX, but reads and writes the central store — so a tag put on
// a file here is the same label the user can filter on at /labels, and the
// same one other modules attach through « Étiquettes Kubuno… ».

interface CoreLabelJson { id: string; name: string; color: string; link_count: number }
interface CoreBrowseItem { resource_type: string; resource_id: string; label_ids: string[] }

/** Prefer the named palette (the pickers highlight it); pass hex through. */
function hexToPaletteName(hex: string): string {
  const found = Object.entries(TAG_COLORS).find(([, h]) => h.toLowerCase() === hex.toLowerCase())
  return found ? found[0] : hex
}

/** Cross-module envelope snapshot stored with each link (rendered at /labels). */
function targetEnvelope(t: TagTarget) {
  return t.kind === 'folder'
    ? {
        kubuno: 1, type: 'drive.folder', module: 'drive', title: t.name,
        href: `/drive?folder=${t.id}`, data: { id: t.id, name: t.name },
      }
    : {
        kubuno: 1, type: 'drive.file', module: 'drive', title: t.name,
        data: { id: t.id, name: t.name, size_bytes: 0, mime_type: '', folder_id: null },
      }
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
    // Labels + drive assignments come from the core in two calls: the label
    // catalogue, and one browse pass over every labeled drive item.
    const [labelsRes, browseRes] = await Promise.all([
      api.get<{ labels: CoreLabelJson[] }>('/labels'),
      api.get<{ items: CoreBrowseItem[] }>('/labels/browse', { params: { module: 'drive' } }),
    ])
    const tags: Tag[] = (labelsRes.data.labels ?? []).map(l => ({
      id: l.id, name: l.name, color: hexToPaletteName(l.color), item_count: l.link_count,
    }))
    const assignments: Record<string, string[]> = {}
    for (const it of browseRes.data.items ?? []) assignments[it.resource_id] = it.label_ids
    set({ tags, assignments })
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
    await api.post('/labels', { name, color: tagColorHex(color) })
    await get().loadTags()
  },

  async updateTag(id, patch) {
    await api.patch(`/labels/${id}`, {
      name: patch.name,
      color: patch.color ? tagColorHex(patch.color) : undefined,
    })
    await get().loadTags()
  },

  async deleteTag(id) {
    // Core-wide deletion: links in EVERY module go with it (cascade).
    await api.delete(`/labels/${id}`)
    set((s) => {
      const assignments: Record<string, string[]> = {}
      for (const [itemId, ids] of Object.entries(s.assignments)) {
        const kept = ids.filter((t) => t !== id)
        if (kept.length) assignments[itemId] = kept
      }
      return { tags: s.tags.filter((t) => t.id !== id), assignments }
    })
  },

  async toggleTag(target, tagId) {
    const current = get().assignments[target.id] ?? []
    const has = current.includes(tagId)
    const next = has ? current.filter((t) => t !== tagId) : [...current, tagId]
    await api.put('/labels/resource', {
      module: 'drive',
      resource_type: target.kind === 'folder' ? 'drive.folder' : 'drive.file',
      resource_id: target.id,
      title: target.name,
      href: target.kind === 'folder' ? `/drive?folder=${target.id}` : undefined,
      envelope: targetEnvelope(target),
      label_ids: next,
    })
    set((s) => {
      const map = { ...s.assignments }
      if (next.length) map[target.id] = next
      else delete map[target.id]
      return { assignments: map }
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
