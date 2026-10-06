import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { filesApi, type FileItem, type Folder, type FolderAncestor } from '@kubuno/drive'
import type { DriveViewOptions } from './useDriveViewOptions'

interface Args {
  folderId:   string | null
  starred:    boolean
  shared:     boolean
  recent:     boolean
  trashed:    boolean
  refreshKey: number
  view:       DriveViewOptions
}

export interface DriveListing {
  folders:       Folder[]
  files:         FileItem[]
  filteredFiles: FileItem[]
  orderedIds:    string[]
  itemTypeMap:   Map<string, 'file' | 'folder'>
  currentFolder: Folder | null
  ancestors:     FolderAncestor[]
  isLoading:     boolean
  filesError:    boolean
}

/** Loads the current view's folders/files and derives the sorted/filtered list. */
export function useDriveListing({ folderId, starred, shared, recent, trashed, refreshKey, view }: Args): DriveListing {
  const { showHidden, typeFilter, sortField, sortDir } = view

  const { data: folderMeta } = useQuery({
    queryKey: ['folder-meta', folderId],
    queryFn:  () => filesApi.getFolder(folderId!),
    enabled:  !!folderId,
  })

  const { data: foldersData, isLoading: loadingFolders } = useQuery({
    queryKey: ['folders', folderId, trashed, refreshKey],
    queryFn:  () => trashed
      ? filesApi.listFolders(null, true)
      : filesApi.listFolders(folderId),
    enabled:  !starred && !shared && !recent,
  })

  const { data: filesData, isLoading: loadingFiles, isError: filesError } = useQuery({
    queryKey: ['files', folderId, starred, recent, trashed, refreshKey],
    // "Recent" = centralized open log (recentApi), not a sort by date.
    queryFn:  () => filesApi.listFiles(folderId, starred, trashed, recent),
    retry:    1,
  })

  const folders = foldersData?.folders ?? []
  const files   = filesData?.files   ?? []
  const currentFolder  = folderMeta?.folder    ?? null
  const ancestors      = folderMeta?.ancestors  ?? []
  const isLoading = loadingFolders || loadingFiles

  const itemTypeMap = useMemo(() => {
    const map = new Map<string, 'file' | 'folder'>()
    folders.forEach(f => map.set(f.id, 'folder'))
    files.forEach(f => map.set(f.id, 'file'))
    return map
  }, [folders, files])

  const filteredFiles = useMemo(() => {
    let result = files
    if (!showHidden) result = result.filter(f => !f.name.startsWith('.'))
    if (typeFilter) {
      result = result.filter(f => {
        if (typeFilter === 'image')    return f.mime_type.startsWith('image/')
        if (typeFilter === 'video')    return f.mime_type.startsWith('video/')
        if (typeFilter === 'audio')    return f.mime_type.startsWith('audio/')
        if (typeFilter === 'document') return f.mime_type.startsWith('text/') || f.mime_type.includes('pdf') || f.mime_type.includes('word') || f.mime_type.includes('spreadsheet') || f.mime_type.includes('presentation') || f.mime_type.includes('opendocument')
        if (typeFilter === 'archive')  return f.mime_type.includes('zip') || f.mime_type.includes('tar') || f.mime_type.includes('gzip') || f.mime_type.includes('rar') || f.mime_type.includes('7z') || f.mime_type.includes('bzip')
        return true
      })
    }
    return [...result].sort((a, b) => {
      let cmp = 0
      if (sortField === 'name') cmp = a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })
      else if (sortField === 'size') cmp = a.size_bytes - b.size_bytes
      else if (sortField === 'date') cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
      else if (sortField === 'type') cmp = a.mime_type.localeCompare(b.mime_type)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [files, typeFilter, sortField, sortDir, showHidden])

  const orderedIds = useMemo(() => [
    ...folders.map(f => f.id),
    ...filteredFiles.map(f => f.id),
  ], [folders, filteredFiles])

  return { folders, files, filteredFiles, orderedIds, itemTypeMap, currentFolder, ancestors, isLoading, filesError }
}
