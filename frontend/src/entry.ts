/**
 * Point d'entrée du bundle MODULE drive (la page /drive), chargé à l'exécution.
 * Buildé séparément (vite.module.config) : core via `@kubuno/sdk`, infra fichiers
 * via `@kubuno/drive`, @ui via `@ui` — tous externes, résolus par l'import map.
 */
import { createElement, lazy } from 'react'
import { Home, Star, Users, Folder, HardDrive } from 'lucide-react'
import DriveMiniPanel from './DriveMiniPanel'
import {
  RouteRegistry,
  SlotRegistry,
  ExtensionRegistry,
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
  useRightPanelStore,
  SDK_VERSION,
  ImageSourceRegistry,
} from '@kubuno/sdk'
import { useFilesStore, useFilesDialogStore, filesApi } from '@kubuno/drive'
import './index.css'
import './i18n'
import DriveLogo from './DriveLogo'
import { openPreview, canPreview } from './previewService'
import { filesNewActionItems } from './FilesNewActions'
import FilesTreeSidebar from './FilesTreeSidebar'
import FilesPaintEditor from './FilesPaintEditor'
import { filesContextMenuItems } from './FilesContextMenuItems'
import { TagInfoSection } from './TagUI'
import FilesStorageGaugeHeader from './FilesStorageGaugeHeader'
import FilesDashboardWidget from './FilesDashboardWidget'
import FilesRecentWidget from './FilesRecentWidget'
import FilesFilterPanel from './FilesFilterPanel'
import FilesOpenDialog from './FilesOpenDialog'
import DriveImageSource from './DriveImageSource'
import FilesSaveDialog from './FilesSaveDialog'
import RemoteStoragePanel from './RemoteStoragePanel'
import FilesFolderPickerDialog from './FilesFolderPickerDialog'
import FilesFloatingAudioPlayer from './FilesFloatingAudioPlayer'

export const sdkVersion = SDK_VERSION

export function register() {
  FaviconRegistry.register('drive', '/drive-logo.png')

  // `landing` opens the module on its "Accueil" hub while `path` stays at the
  // resolvable root (/drive → Mon Drive, still matched by resolveByPath). Passed
  // via a variable because `landing` is not yet in the published @kubuno/sdk
  // WaffleApp type; the up-to-date host reads it at runtime (cf. `mobileTabs`).
  const driveWaffleApps = [
    { id: 'drive', label: 'Drive', Icon: DriveLogo, path: '/drive', landing: '/drive/home' },
  ]
  WaffleAppRegistry.register('drive', 'Drive', driveWaffleApps)

  WidgetRegistry.register({ id: 'drive-recent', moduleId: 'drive', Component: FilesRecentWidget, size: 'medium', order: 20 })

  // The header gear button opens the per-user Drive settings while in /drive.
  // (WebDAV, formerly a core `settings-sections` panel, is now a tab there.)
  ModuleSettingsRegistry.register('drive')

  // Contribute the "Drive" tab to the core image picker (available app-wide).
  ImageSourceRegistry.add({
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

  // Sidebar "New" button: contribute MenuItem[] DATA to the generic
  // 'shell.new-actions' extension point (consumed by the shell's MenuDropdown).
  ExtensionRegistry.register('shell.new-actions', 'drive', {
    moduleId: 'drive',
    items: filesNewActionItems,
  })

  // Background context menu: MenuItem[] DATA for the shell's MenuDropdown
  // (literal point name — no @kubuno/sdk republish needed for the constant).
  ExtensionRegistry.register('shell.context-menu-items', 'drive', {
    moduleId: 'drive',
    items: filesContextMenuItems,
  })

  SlotRegistry.register('topbar-actions',        'drive', FilesStorageGaugeHeader)
  SlotRegistry.register('dashboard-stats-cards', 'drive', FilesDashboardWidget)
  SlotRegistry.register('app-dialogs',           'drive', FilesOpenDialog)
  SlotRegistry.register('app-dialogs',           'drive', FilesSaveDialog)
  SlotRegistry.register('app-dialogs',           'drive', FilesFolderPickerDialog)
  // Shell-level, not inside DriveApp: the sidebar's mount context menu opens
  // this from ANY drive route, and DriveApp only exists on a few of them — so
  // "Gérer les montages" set the flag and nothing appeared until the user
  // navigated back to Mon Drive.
  SlotRegistry.register('app-dialogs',           'drive', RemoteStoragePanel)
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

  // Side panel: recents and starred, to grab a file from another module.
  useRightPanelStore.getState().registerEntry({
    moduleId:       'drive',
    icon:           DriveLogo,
    label:          'Drive',
    panelComponent: DriveMiniPanel,
    openPath:       '/drive',
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

  const DriveHome = lazy(() => import('./DriveHome'))

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

    // Viewer offered to other modules: preview any URL (mail attachments,
    // chat files…) with Drive's own renderers. `canPreview` lets the caller
    // fall back to a download without opening an empty overlay.
    // Two shapes: a single source, or `{ items, index }` for a whole set (all
    // the attachments of one e-mail) — the previewer then offers the same
    // « n / N ‹ › » navigation as Drive, viewer switching included.
    openPreview: (
      source: { url: string; name: string; mime?: string }
            | { items: Array<{ url: string; name: string; mime?: string }>; index?: number },
    ) => openPreview(source),
    canPreview:  (mime?: string, name?: string) => canPreview(mime, name),

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
