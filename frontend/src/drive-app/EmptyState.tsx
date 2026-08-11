import { useTranslation } from 'react-i18next'
import { Folder as FolderIcon, Star, Share2, Trash2, CloudUpload } from 'lucide-react'

export default function EmptyState({ trashed, starred, shared, recent }: { trashed: boolean; starred: boolean; shared: boolean; recent: boolean }) {
  const { t } = useTranslation('drive')
  if (trashed)  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
      <Trash2 size={52} className="text-text-tertiary" />
      <p className="text-text-secondary text-sm">{t('app.empty_trash_state')}</p>
    </div>
  )
  if (starred)  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
      <Star size={52} className="text-text-tertiary" />
      <p className="text-text-secondary text-sm">{t('app.empty_starred')}</p>
      <p className="text-text-tertiary text-xs">{t('app.empty_starred_hint')}</p>
    </div>
  )
  if (shared)   return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
      <Share2 size={52} className="text-text-tertiary" />
      <p className="text-text-secondary text-sm">{t('app.empty_shared')}</p>
    </div>
  )
  if (recent)   return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
      <FolderIcon size={52} className="text-text-tertiary" />
      <p className="text-text-secondary text-sm">{t('app.empty_recent')}</p>
    </div>
  )
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
      <CloudUpload size={52} className="text-text-tertiary" />
      <p className="text-text-secondary text-sm">{t('app.empty_folder')}</p>
      <p className="text-text-tertiary text-xs">
        {t('app.dnd_hint', { import: t('common.import'), folder: t('app.folder_btn') })}
      </p>
    </div>
  )
}
