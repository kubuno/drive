import { useTranslation } from 'react-i18next'
import { FilesOpenWithContext, type FileItem } from '@kubuno/drive'
import { MenuDropdown } from '@ui'
import { buildItemMenuItems, type ItemMenuHandlers } from './itemMenu'
import type { MenuTarget } from './types'

/** Item context menu (files and folders) rendered at the pointer position. */
export default function DriveContextMenu({ menu, handlers, onClose }: {
  menu:     NonNullable<MenuTarget>
  handlers: ItemMenuHandlers
  onClose:  () => void
}) {
  const { t } = useTranslation('drive')
  return (
    /* Provider required: the "Open with" contributors (files-open-with slot)
       read the target file through useFilesOpenWith() — without it they render null. */
    <FilesOpenWithContext.Provider value={menu.type === 'file' ? (menu.item as FileItem) : null}>
      <MenuDropdown
        pos={{ top: menu.y, left: menu.x }}
        onClose={onClose}
        items={buildItemMenuItems(menu, t, handlers)}
      />
    </FilesOpenWithContext.Provider>
  )
}
