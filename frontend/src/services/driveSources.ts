// Virtual StorageSource(s) for the Drive's special views. They reuse the shared
// StorageExplorer (one explorer, one menu) by deriving from the local source and
// overriding only what differs — chiefly list() returns a flat, filtered listing.
import { localSource, filesApi, recentApi, type FileItem, type Folder } from '@kubuno/drive'
import { api } from '@kubuno/sdk'

type LocalSource = ReturnType<typeof localSource>
type Caps = LocalSource['capabilities']

/** Builds a flat (non-hierarchical) source from a filtered listing. All per-item
 *  operations (rename, trash, star, download…) delegate to the local source, so
 *  the shared menu keeps working unchanged. */
function flatSource(
  key: string,
  name: string,
  listItems: () => Promise<{ folders?: Folder[]; files: FileItem[] }>,
  extraCaps: Partial<Caps> = {},
): LocalSource {
  const base = localSource()
  return {
    ...base,
    key,
    // A virtual list isn't a folder you upload/create into.
    capabilities: { ...base.capabilities, upload: false, mkdir: false, ...extraCaps },
    resolveRoot: async () => ({ id: null, name }),
    resolveAncestors: async () => [],
    list: async (parentId: string | null) => {
      if (parentId === null) {
        const { folders, files } = await listItems()
        return { folders: folders ?? [], files }
      }
      // Navigating into a real folder (rare from a flat view) → normal listing.
      return base.list(parentId)
    },
  }
}

/** « Récents » : journal centralisé des fichiers récemment OUVERTS (recentApi),
 *  toutes apps confondues — au lieu d'un simple tri par date de modification. */
export function recentSource(): LocalSource {
  return flatSource('recent', 'Récents', async () => {
    const files = await recentApi.list({ limit: 30 })
    return { folders: [], files }
  })
}

/** « Accueil » : a curated blend distinct from « Récents » (which is the opened
 *  journal). Unions starred files, files recently MODIFIED across the whole drive
 *  (`updated_at`, not `opened_at`), and files recently shared with the user, then
 *  dedupes and orders by last modification. Also surfaces the folders the user
 *  most recently worked in. Rendered by the SAME explorer as every other view. */
export function suggestionsSource(): LocalSource {
  return flatSource('suggestions', 'Accueil', async () => {
    const [starred, modified, shared] = await Promise.all([
      filesApi.listFiles(null, true).then(r => r.files).catch(() => [] as FileItem[]),
      filesApi.listFiles(null, false, false, true, undefined, { limit: 60 }).then(r => r.files).catch(() => [] as FileItem[]),
      api.get<{ files?: FileItem[] }>('/drive/shares/received-items').then(r => r.data.files ?? []).catch(() => [] as FileItem[]),
    ])

    // Union + dedupe by id (skip trashed), newest modification first.
    const byId = new Map<string, FileItem>()
    for (const f of [...starred, ...shared, ...modified]) {
      if (f.is_trashed || byId.has(f.id)) continue
      byId.set(f.id, f)
    }
    const files = [...byId.values()]
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
      .slice(0, 30)

    // Suggested folders: parents of the surfaced files, padded with top-level
    // folders so the row is never empty.
    const parentIds: string[] = []
    const seenParent = new Set<string>()
    for (const f of files) {
      const p = f.folder_id
      if (p && !seenParent.has(p)) { seenParent.add(p); parentIds.push(p) }
    }
    const derived = (await Promise.all(
      parentIds.slice(0, 10).map(id => filesApi.getFolder(id).then(r => r.folder).catch(() => null)),
    )).filter((f): f is Folder => !!f && !f.is_trashed)

    const folders = [...derived]
    if (folders.length < 8) {
      const roots = await filesApi.listFolders(null).then(r => r.folders).catch(() => [] as Folder[])
      for (const r of roots) {
        if (folders.length >= 8) break
        if (!folders.some(m => m.id === r.id)) folders.push(r)
      }
    }
    return { folders: folders.slice(0, 12), files }
  })
}

/** « Étoilés » : flat list of starred files. */
export function starredSource(): LocalSource {
  return flatSource('starred', 'Étoilés', async () => {
    const { files } = await filesApi.listFiles(null, true)
    return { folders: [], files }
  })
}

/** « Partagés avec moi » : folders/files internally shared with the user. Read-only
 *  (the user isn't the owner) — only open/download/info are allowed. */
export function sharedSource(): LocalSource {
  const base = localSource()
  return {
    ...base,
    key: 'shared',
    capabilities: {
      ...base.capabilities,
      upload: false, mkdir: false, rename: false, move: false, copy: false,
      trash: false, delete: false, star: false, color: false, share: false,
      getLink: false, versions: false, compress: false, decompress: false,
    },
    resolveRoot: async () => ({ id: null, name: 'Partagés avec moi' }),
    resolveAncestors: async () => [],
    list: async (parentId: string | null) => {
      if (parentId === null) {
        const { data } = await api.get<{ folders: Folder[]; files: FileItem[] }>('/drive/shares/received-items')
        return { folders: data.folders ?? [], files: data.files ?? [] }
      }
      // Browsing into a shared folder's subtree isn't supported yet (ownership).
      return { folders: [], files: [] }
    },
  }
}
