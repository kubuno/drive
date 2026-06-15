import { useTranslation } from 'react-i18next'
import { Dropdown, Checkbox, Button, Input } from '@ui'
import { useFilesStore, type FilesSearchFilters } from '@kubuno/drive'
const rowClass   = 'flex items-start gap-6'
const labelClass = 'text-sm font-medium text-text-primary w-44 shrink-0 pt-2'

export default function FilesFilterPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('drive')
  const { searchFilters, setSearchFilters, applySearch, clearSearch } = useFilesStore()

  const handleSearch = () => { applySearch(); onClose() }
  const handleReset  = () => { clearSearch(); onClose() }

  return (
    <div className="py-5 px-6 space-y-4" style={{ minWidth: 580 }}>

      {/* Type */}
      <div className={rowClass}>
        <span className={labelClass}>{t('filter.type')}</span>
        <Dropdown
          className="flex-1"
          value={searchFilters.type}
          onChange={v => setSearchFilters({ type: v as FilesSearchFilters['type'] })}
          options={[
            { value: 'all',          label: t('filter.t_all') },
            { value: 'folder',       label: t('filter.t_folder') },
            { value: 'document',     label: t('filter.t_document') },
            { value: 'spreadsheet',  label: t('filter.t_spreadsheet') },
            { value: 'presentation', label: t('filter.t_presentation') },
            { value: 'pdf',          label: t('filter.t_pdf') },
            { value: 'image',        label: t('filter.t_image') },
            { value: 'video',        label: t('filter.t_video') },
            { value: 'audio',        label: t('filter.t_audio') },
            { value: 'archive',      label: t('filter.t_archive') },
          ]}
        />
      </div>

      {/* Propriétaire */}
      <div className={rowClass}>
        <span className={labelClass}>{t('filter.owner')}</span>
        <Dropdown
          className="flex-1"
          value={searchFilters.owner}
          onChange={v => setSearchFilters({ owner: v as FilesSearchFilters['owner'] })}
          options={[
            { value: 'anyone', label: t('filter.o_anyone') },
            { value: 'me',     label: t('filter.o_me') },
            { value: 'notme',  label: t('filter.o_notme') },
          ]}
        />
      </div>

      {/* Contient les mots */}
      <div className={rowClass}>
        <label className={labelClass}>{t('filter.contains')}</label>
        <div className="flex-1">
          <Input
            type="text"
            placeholder={t('filter.contains_ph')}
            value={searchFilters.containsWords}
            onChange={e => setSearchFilters({ containsWords: e.target.value })}
          />
        </div>
      </div>

      {/* Nom de l'élément */}
      <div className={rowClass}>
        <label className={labelClass}>{t('filter.item_name')}</label>
        <div className="flex-1">
          <Input
            type="text"
            placeholder={t('filter.name_ph')}
            value={searchFilters.itemName}
            onChange={e => setSearchFilters({ itemName: e.target.value })}
          />
        </div>
      </div>

      {/* Emplacement */}
      <div className={rowClass}>
        <span className={labelClass}>{t('filter.location')}</span>
        <div className="flex flex-col gap-2">
          <Dropdown
            className="flex-1"
            value={searchFilters.location}
            onChange={v => setSearchFilters({ location: v as FilesSearchFilters['location'] })}
            options={[
              { value: 'everywhere', label: t('filter.loc_everywhere') },
              { value: 'mydrive',    label: t('nav.my_files') },
            ]}
          />
          <div className="flex items-center gap-5 mt-1">
            <Checkbox
              label={t('filter.in_trash')}
              checked={searchFilters.inTrash}
              onChange={v => setSearchFilters({ inTrash: v })}
            />
            <Checkbox
              label={t('filter.starred')}
              checked={searchFilters.isStarred}
              onChange={v => setSearchFilters({ isStarred: v })}
            />
          </div>
        </div>
      </div>

      {/* Date de modification */}
      <div className={rowClass}>
        <span className={labelClass}>{t('filter.modified')}</span>
        <Dropdown
          className="flex-1"
          value={searchFilters.modifiedDate}
          onChange={v => setSearchFilters({ modifiedDate: v as FilesSearchFilters['modifiedDate'] })}
          options={[
            { value: 'anytime',  label: t('filter.d_anytime') },
            { value: 'today',    label: t('filter.d_today') },
            { value: '7days',    label: t('filter.d_7days') },
            { value: '30days',   label: t('filter.d_30days') },
            { value: 'thisyear', label: t('filter.d_thisyear') },
            { value: 'lastyear', label: t('filter.d_lastyear') },
          ]}
        />
      </div>

      {/* Partagé avec */}
      <div className={rowClass}>
        <label className={labelClass}>{t('filter.shared_with')}</label>
        <div className="flex-1">
          <Input
            type="text"
            placeholder={t('filter.shared_ph')}
            value={searchFilters.sharedWith}
            onChange={e => setSearchFilters({ sharedWith: e.target.value })}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={handleReset}>{t('filter.reset')}</Button>
        <Button type="button" onClick={handleSearch}>{t('filter.search')}</Button>
      </div>
    </div>
  )
}
