import { HardDrive } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@kubuno/sdk'
import { useModulesStore } from '@kubuno/sdk'
import { formatSize } from '@kubuno/drive'
export default function FilesStorageGauge() {
  const { t } = useTranslation('drive')
  const { user } = useAuthStore()
  const { activeModules } = useModulesStore()
  const navigate = useNavigate()
  if (!user || user.quota_bytes === 0 || !activeModules.some((m) => m.module_id === 'files')) return null

  const pct = Math.min(100, Math.round((user.used_bytes / user.quota_bytes) * 100))
  const barColor =
    pct > 90 ? 'bg-danger' :
    pct > 70 ? 'bg-warning' :
    'bg-primary'

  return (
    <>
      <div className="mx-3 my-2 h-px bg-border" />
      <div className="px-1 py-1 mb-1">
        <button
          onClick={() => navigate('/drive/storage')}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-full text-sm
                     transition-colors text-left select-none hover:bg-surface-2"
        >
          <HardDrive size={20} className="text-text-tertiary flex-shrink-0" />
          <span className="truncate flex-1 text-sm text-text-secondary">
            {t('storage.title')}
          </span>
        </button>
        <div className="px-3 pb-1">
          <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden mb-1.5">
            <div
              className={`h-full ${barColor} rounded-full transition-all duration-500`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-text-tertiary leading-relaxed">
            {formatSize(user.used_bytes)} {t('storage.used_suffix', { quota: formatSize(user.quota_bytes) })}
          </p>
        </div>
      </div>
    </>
  )
}
