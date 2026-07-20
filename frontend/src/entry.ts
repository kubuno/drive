/**
 * Point d'entrée du bundle MODULE drive (la page /drive), chargé à l'exécution.
 * Buildé séparément (vite.module.config) : core via `@kubuno/sdk`, infra fichiers
 * via `@kubuno/drive`, @ui via `@ui` — tous externes, résolus par l'import map.
 */
import { createElement, lazy } from 'react'
import { Home, Star, Users, Folder, HardDrive } from 'lucide-react'
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
import DriveImageSource from './DriveImageSource'
import { ImageSourceRegistry } from './imageSourceSdk'
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

  // Contribute the "Drive" tab to the core image picker (available app-wide).
  ImageSourceRegistry?.add({
    id: 'drive', label: 'Drive', order: 20, group: 'library',
    searchable: true, searchPlaceholder: 'Rechercher dans Drive…',
    icon: createElement(HardDrive, { size: 18 }),
    Component: DriveImageSource,
  })

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

  // Barre de navigation basse (mobile) : le shell rend ces onglets à la place de
  // ses destinations génériques tant qu'on est dans /drive.
  // NB : objet passé via une variable — `mobileTabs` n'existe pas encore dans les
  // types npm @kubuno/sdk 0.1.2 (le host à jour le lit au runtime). Inliner le
  // littéral déclencherait le contrôle des propriétés excédentaires de TS.
  const mobileTabs = [
    { id: 'home',    labelKey: 'drive:nav.home',         Icon: Home,   path: '/drive/home' },
    { id: 'starred', labelKey: 'drive:nav.favorites',    Icon: Star,   path: '/drive/starred' },
    { id: 'shared',  labelKey: 'drive:nav.shared_short', Icon: Users,  path: '/drive/shared' },
    { id: 'files',   labelKey: 'drive:nav.files',        Icon: Folder, path: '/drive', end: true },
  ]

  // NB : configs passées via des VARIABLES — `mobileTabs` n'existe pas encore dans
  // les types npm @kubuno/sdk 0.1.2 (le host à jour le lit au runtime), et un
  // littéral inline déclencherait le contrôle des propriétés excédentaires de TS.
  const driveSidebar = {
    moduleId:    'drive',
    routePrefix: '/drive',
    NewActions:  FilesNewActions,
    SidebarBody: FilesTreeSidebar,
    collapsedBody: true,
    mobileTabs,
  }
  useSidebarStore.getState().register(driveSidebar)

  // Settings/storage pages: same nav, but NO "New" action — the mobile FAB is
  // built from it, and a "New folder" button floating over the preferences form
  // makes no sense. A more specific routePrefix wins in resolveActiveSidebarConfig.
  for (const routePrefix of ['/drive/settings', '/drive/storage']) {
    const settingsSidebar = {
      moduleId:    `drive${routePrefix.replace(/\//g, '-')}`,
      routePrefix,
      SidebarBody: FilesTreeSidebar,
      collapsedBody: true,
      mobileTabs,
    }
    useSidebarStore.getState().register(settingsSidebar)
  }

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
  const DrivePlayerPage   = lazy(() => import('./FilesStandalonePages'))
  const DrivePaintPage    = lazy(() => import('./FilesStandalonePages').then(m => ({ default: m.DrivePaintPage })))

  const DriveHome = lazy(() => import('./MobileHome'))

  RouteRegistry.register('drive',          FilesApp)
  RouteRegistry.register('drive/home',     DriveHome)
  RouteRegistry.register('drive/split',    DualPaneExplorer)
  RouteRegistry.register('drive/recent',   FilesApp, { recent:  true })
  RouteRegistry.register('drive/starred',  FilesApp, { starred: true })
  RouteRegistry.register('drive/shared',   FilesApp, { shared:  true })
  RouteRegistry.register('drive/trash',    FilesApp, { trashed: true })
  RouteRegistry.register('drive/settings', DriveSettingsPage)
  RouteRegistry.register('drive/storage',  FilesStoragePage)
  RouteRegistry.register('drive/remote/:id', RemoteBrowser)
  RouteRegistry.register('drive/system',     SystemBrowser)
  // Pop-out desktop : lecteur audio / éditeur Paint dans leur propre fenêtre OS.
  RouteRegistry.register('drive/player',     DrivePlayerPage)
  RouteRegistry.register('drive/paint',      DrivePaintPage)
  // Storage mounts published by other active modules (e.g. p2pnas → "My Cloud").
  const ModuleMountBrowser = lazy(() => import('./ModuleMountExplorer'))
  RouteRegistry.register('drive/m/:moduleId/:mountKey', ModuleMountBrowser)

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
