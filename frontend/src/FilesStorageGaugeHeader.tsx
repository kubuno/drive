import { HardDrive } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@kubuno/sdk'
import { formatSize } from '@kubuno/drive'

// Compact storage gauge for the app header (topbar-actions slot): icon + thin
// usage bar + "used / quota" label, color-coded by fill ratio. Clicking
// navigates to the storage page. Hidden on mobile (the header is cramped there).
// The topbar-actions slot renders in EVERY module's header, so we scope it to
// Drive routes only — it must not appear in mail/calendar/etc.
export default function FilesStorageGaugeHeader() {
  const { t } = useTranslation('drive')
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const onDrive = pathname === '/drive' || pathname.startsWith('/drive/')
  if (!onDrive || !user || user.quota_bytes === 0) return null

  const pct = Math.min(100, Math.round((user.used_bytes / user.quota_bytes) * 100))
  const barColor =
    pct > 90 ? 'bg-danger' :
    pct > 70 ? 'bg-warning' :
    'bg-primary'

  const label = `${formatSize(user.used_bytes)} ${t('storage.used_suffix', { quota: formatSize(user.quota_bytes) })}`

  return (
    <button
      onClick={() => navigate('/drive/storage')}
      title={`${t('storage.title')} — ${label}`}
      aria-label={`${t('storage.title')} — ${label}`}
      className="hidden lg:flex items-center gap-2 h-9 px-3 mr-1 rounded-full
                 transition-colors select-none hover:bg-surface-3"
    >
      <HardDrive size={16} className="text-text-tertiary flex-shrink-0" />
      <div className="w-20 h-1.5 bg-black/10 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-text-secondary tabular-nums whitespace-nowrap">
        {formatSize(user.used_bytes)} / {formatSize(user.quota_bytes)}
      </span>
    </button>
  )
}
