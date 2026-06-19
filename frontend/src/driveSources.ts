// Virtual StorageSource(s) for the Drive's special views. They reuse the shared
// StorageExplorer (one explorer, one menu) by deriving from the local source and
// overriding only what differs — chiefly list() returns a flat, filtered listing.
import { localSource, filesApi, type FileItem, type Folder } from '@kubuno/drive'
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

/** « Récents » : flat list of recently-modified files. */
export function recentSource(): LocalSource {
  return flatSource('recent', 'Récents', async () => {
    const { files } = await filesApi.listFiles(null, false, false, true)
    return { folders: [], files }
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
