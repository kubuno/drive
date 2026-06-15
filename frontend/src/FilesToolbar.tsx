import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

const VIEW_KEYS: Record<string, string> = {
  '/drive':          'nav.my_files',
  '/drive/recent':   'nav.recent',
  '/drive/starred':  'nav.favorites',
  '/drive/shared':   'nav.shared',
  '/drive/trash':    'nav.trash',
  '/drive/settings': 'nav.storage_settings',
}

export default function FilesToolbar() {
  const { t } = useTranslation('drive')
  const { pathname } = useLocation()
  const title = t(VIEW_KEYS[pathname] ?? 'nav.files')

  return (
    <div className="flex items-center h-14 px-4 gap-3">
      <h1 className="text-[22px] font-normal text-text-primary flex-1 truncate tracking-tight">
        {title}
      </h1>
    </div>
  )
}
