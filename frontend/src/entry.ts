/**
 * Point d'entrée du bundle MODULE drive (la page /drive), chargé à l'exécution.
 * Buildé séparément (vite.module.config) : core via `@kubuno/sdk`, infra fichiers
 * via `@kubuno/drive`, @ui via `@ui` — tous externes, résolus par l'import map.
 */
import { lazy } from 'react'
import {
  RouteRegistry,
  SlotRegistry,
  WidgetRegistry,
  ModuleServiceRegistry,
  ModuleSettingsRegistry,
  NotificationRegistry,
  WaffleAppRegistry,
  FaviconRegistry,
  useSidebarStore,
  useToolbarStore,
  useSearchStore,
  i18n,
  SDK_VERSION,
} from '@kubuno/sdk'
import { useFilesStore, useFilesDialogStore, filesApi } from '@kubuno/drive'
import './index.css'
import './i18n'
import DriveLogo from './DriveLogo'
import FilesNewActions from './FilesNewActions'
import FilesTreeSidebar from './FilesTreeSidebar'
import FilesPaintEditor from './FilesPaintEditor'
import FilesContextMenuItems from './FilesContextMenuItems'
import { TagInfoSection } from './TagUI'
import FilesStorageGaugeHeader from './FilesStorageGaugeHeader'
import FilesDashboardWidget from './FilesDashboardWidget'
import FilesRecentWidget from './FilesRecentWidget'
import FilesFilterPanel from './FilesFilterPanel'
import FilesOpenDialog from './FilesOpenDialog'
import FilesSaveDialog from './FilesSaveDialog'
import FilesFolderPickerDialog from './FilesFolderPickerDialog'
import FilesFloatingAudioPlayer from './FilesFloatingAudioPlayer'

export const sdkVersion = SDK_VERSION

export function register() {
  FaviconRegistry.register('drive', '/drive-logo.svg')

  WaffleAppRegistry.register('drive', 'Drive', [
    { id: 'drive', label: 'Drive', Icon: DriveLogo, path: '/drive' },
  ])

  WidgetRegistry.register({ id: 'drive-recent', moduleId: 'drive', Component: FilesRecentWidget, size: 'medium', order: 20 })

  // The header gear button opens the per-user Drive settings while in /drive.
  // (WebDAV, formerly a core `settings-sections` panel, is now a tab there.)
  ModuleSettingsRegistry.register('drive')

  // Declare the notification activities shown in the core Settings → Notifications matrix.
  NotificationRegistry.register({
    moduleId: 'drive',
    title: 'Fichiers et partage',
    order: 50,
    activities: [
      { id: 'item_shared', label: 'Un fichier ou un dossier est partagé avec vous', emailDefault: true, pushDefault: true },
      { id: 'file_comment', label: 'Un commentaire est ajouté sur un fichier' },
      { id: 'link_downloaded', label: 'Un fichier partagé par lien a été téléchargé' },
      { id: 'shared_upload', label: 'Un téléversement a lieu dans un dossier partagé' },
    ],
  })

  SlotRegistry.register('sidebar-new-actions',   'drive', FilesNewActions)
  SlotRegistry.register('context-menu-items',    'drive', FilesContextMenuItems)
  SlotRegistry.register('topbar-actions',        'drive', FilesStorageGaugeHeader)
  SlotRegistry.register('dashboard-stats-cards', 'drive', FilesDashboardWidget)
  SlotRegistry.register('app-dialogs',           'drive', FilesOpenDialog)
  SlotRegistry.register('app-dialogs',           'drive', FilesSaveDialog)
  SlotRegistry.register('app-dialogs',           'drive', FilesFolderPickerDialog)
  SlotRegistry.register('app-dialogs',           'drive', FilesFloatingAudioPlayer)
  SlotRegistry.register('app-dialogs',           'drive', FilesPaintEditor)
  SlotRegistry.register('files-info-extra',      'drive', TagInfoSection)

  useSidebarStore.getState().register({
    moduleId:    'drive',
    routePrefix: '/drive',
    NewActions:  FilesNewActions,
    SidebarBody: FilesTreeSidebar,
    collapsedBody: true,
  })

  useToolbarStore.getState().register({
    moduleId:    'drive',
    routePrefix: '/drive',
    noPadding:   true,
  })

  useToolbarStore.getState().register({
    moduleId:    'drive-settings',
    routePrefix: '/drive/settings',
  })

  useSearchStore.getState().register({
    moduleId:    'drive',
    routePrefix: '/drive',
    placeholder: i18n.t('drive:nav.search_ph'),
    onSearch:    (q) => useFilesStore.getState().setSearchQuery(q),
    onImageSearch: (file) => { void useFilesStore.getState().runImageSearch(file) },
    FilterPanel: FilesFilterPanel,
  })

  // Routes
  const FilesApp          = lazy(() => import('./DriveApp'))
  const DriveSettingsPage = lazy(() => import('./DriveSettingsPage'))
  const FilesStoragePage  = lazy(() => import('./FilesStoragePage'))
  const RemoteBrowser     = lazy(() => import('./RemoteExplorer'))
  const SystemBrowser     = lazy(() => import('./SystemExplorer'))
  const DualPaneExplorer  = lazy(() => import('./DualPaneExplorer'))

  RouteRegistry.register('drive',          FilesApp)
  RouteRegistry.register('drive/split',    DualPaneExplorer)
  RouteRegistry.register('drive/recent',   FilesApp, { recent:  true })
  RouteRegistry.register('drive/starred',  FilesApp, { starred: true })
  RouteRegistry.register('drive/shared',   FilesApp, { shared:  true })
  RouteRegistry.register('drive/trash',    FilesApp, { trashed: true })
  RouteRegistry.register('drive/settings', DriveSettingsPage)
  RouteRegistry.register('drive/storage',  FilesStoragePage)
  RouteRegistry.register('drive/remote/:id', RemoteBrowser)
  RouteRegistry.register('drive/system',     SystemBrowser)

  // API publique consommable par d'autres modules via ModuleServiceRegistry
  ModuleServiceRegistry.publish('drive', {
    getCurrentFolderId: () => useFilesStore.getState().currentFolderId,
    openFilePicker:     (opts?: object) => useFilesDialogStore.getState().openFile(opts),
    pickFolder:         (opts?: object) => useFilesDialogStore.getState().pickFolder(opts),
    thumbnailUrl:       (id: string) => filesApi.thumbnailUrl(id),
    downloadUrl:        (id: string) => filesApi.downloadUrl(id),

    listFolders:  (parentId?: string | null) => filesApi.listFolders(parentId),
    getFolder:    (id: string) => filesApi.getFolder(id),
    createFolder: (name: string, parentId?: string | null) => filesApi.createFolder(name, parentId ?? null),
    renameFolder: (id: string, name: string) => filesApi.renameFolder(id, name),
    deleteFolder: (id: string) => filesApi.deleteFolder(id),

    listFiles:   (folderId?: string | null) => filesApi.listFiles(folderId),
    uploadFile:  (file: File, folderId?: string | null) => filesApi.uploadFile(file, folderId),
    renameFile:  (id: string, name: string) => filesApi.renameFile(id, name),
    trashFile:   (id: string) => filesApi.trashFile(id),
    restoreFile: (id: string) => filesApi.restoreFile(id),
    deleteFile:  (id: string) => filesApi.deleteFile(id),
  })
}
