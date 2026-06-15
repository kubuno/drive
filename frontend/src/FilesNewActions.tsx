import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { FolderPlus, Upload, FolderInput, Link2, Server } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useFilesStore } from '@kubuno/drive'
import { Slot, SlotRegistry } from '@kubuno/sdk'
import { useModulesStore } from '@kubuno/sdk'
const ITEM_CLASS =
  'flex items-center gap-3 w-full px-3 py-2 text-sm text-text-primary ' +
  'hover:bg-surface-1 cursor-pointer outline-none'

export default function FilesNewActions() {
  const { t } = useTranslation('drive')
  const { openNewFolder, triggerUpload, triggerFolderUpload, openImportUrl, openRemotesPanel } = useFilesStore()
  const location      = useLocation()
  const activeModules = useModulesStore(s => s.activeModules)
  const activeIds     = new Set(activeModules.map(m => m.module_id))

  if (!location.pathname.startsWith('/drive')) return null

  const hasContributors = SlotRegistry.getSlot('files-new-actions').some(e => activeIds.has(e.moduleId))

  return (
    <>
      <DropdownMenu.Item onSelect={openNewFolder} className={ITEM_CLASS}>
        <FolderPlus size={16} className="text-text-secondary" />
        {t('newfolder.title')}
      </DropdownMenu.Item>
      <DropdownMenu.Item onSelect={triggerUpload} className={ITEM_CLASS}>
        <Upload size={16} className="text-text-secondary" />
        {t('actions.upload_files')}
      </DropdownMenu.Item>
      <DropdownMenu.Item onSelect={triggerFolderUpload} className={ITEM_CLASS}>
        <FolderInput size={16} className="text-text-secondary" />
        {t('actions.upload_folder')}
      </DropdownMenu.Item>
      <DropdownMenu.Item onSelect={openImportUrl} className={ITEM_CLASS}>
        <Link2 size={16} className="text-text-secondary" />
        {t('actions.import_url')}
      </DropdownMenu.Item>
      <div className="my-1 h-px bg-border mx-2" />
      <DropdownMenu.Item onSelect={openRemotesPanel} className={ITEM_CLASS}>
        <Server size={16} className="text-text-secondary" />
        {t('actions.remotes')}
      </DropdownMenu.Item>

      {hasContributors && (
        <>
          <div className="my-1 h-px bg-border mx-2" />
          <Slot name="files-new-actions" />
        </>
      )}
    </>
  )
}
