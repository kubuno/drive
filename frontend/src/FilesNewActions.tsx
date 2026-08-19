/**
 * Items of the sidebar "New" button for Drive — DATA for the project's menu
 * component (`MenuDropdown` from @ui), contributed through the generic
 * 'shell.new-actions' extension point (see entry.ts). The function is evaluated
 * when the menu opens, so labels and store state are always fresh, without hooks.
 */
import type { MenuItem } from '@ui'
import { FolderPlus, Upload, FolderInput, Link2, Server } from 'lucide-react'
import { useFilesStore } from '@kubuno/drive'
import { ExtensionRegistry, i18n, useModulesStore } from '@kubuno/sdk'

/** Extension point where OTHER modules add entries to Drive's "New" menu —
 *  the data counterpart of the former 'files-new-actions' component slot.
 *  Contributors register with the same schema as 'shell.new-actions':
 *    ExtensionRegistry.register(DRIVE_NEW_ACTIONS, '<id>',
 *      { moduleId: '<id>', items: () => MenuItem[] })
 */
export const DRIVE_NEW_ACTIONS = 'drive.new-actions'

export interface DriveNewActionsProvider {
  /** Owning module — only contributions of ACTIVE modules are shown. */
  moduleId: string
  /** Built when the menu opens (fresh labels/state), never at registration time. */
  items: () => MenuItem[]
  /** Lower comes first when several providers contribute. */
  order?: number
}

export function filesNewActionItems(): MenuItem[] {
  if (!window.location.pathname.startsWith('/drive')) return []

  const t = (key: string) => i18n.t(`drive:${key}`)
  // Read the store at click time, not at build time — actions stay fresh.
  const files = () => useFilesStore.getState()

  const items: MenuItem[] = [
    {
      type: 'action',
      label: t('newfolder.title'),
      icon: <FolderPlus size={16} className="text-text-secondary" />,
      onClick: () => files().openNewFolder(),
    },
    {
      type: 'action',
      label: t('actions.upload_files'),
      icon: <Upload size={16} className="text-text-secondary" />,
      onClick: () => files().triggerUpload(),
    },
    {
      type: 'action',
      label: t('actions.upload_folder'),
      icon: <FolderInput size={16} className="text-text-secondary" />,
      onClick: () => files().triggerFolderUpload(),
    },
    {
      type: 'action',
      label: t('actions.import_url'),
      icon: <Link2 size={16} className="text-text-secondary" />,
      onClick: () => files().openImportUrl(),
    },
    { type: 'separator' },
    {
      type: 'action',
      label: t('actions.remotes'),
      icon: <Server size={16} className="text-text-secondary" />,
      onClick: () => files().openRemotesPanel(),
    },
  ]

  // Contributions of other ACTIVE modules (e.g. office's "New document"),
  // read from the 'drive.new-actions' extension point — same active-module
  // filtering the former <Slot name="files-new-actions"> applied.
  const activeIds = new Set(
    useModulesStore.getState().activeModules.map((m) => m.module_id),
  )
  const contributed = ExtensionRegistry.getAll<DriveNewActionsProvider>(DRIVE_NEW_ACTIONS)
    .filter((p) => activeIds.has(p.moduleId))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .flatMap((p) => p.items())
  if (contributed.length > 0) items.push({ type: 'separator' }, ...contributed)

  return items
}
