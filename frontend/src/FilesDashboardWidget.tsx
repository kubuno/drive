import { HardDrive } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '@kubuno/sdk'
import { useModulesStore } from '@kubuno/sdk'
import { formatSize } from '@kubuno/drive'
interface Stats { storage_used: number }

export default function FilesDashboardWidget() {
  const { t } = useTranslation('drive')
  const { activeModules } = useModulesStore()
  const isActive = activeModules.some((m) => m.module_id === 'files')

  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api.get<Stats>('/admin/stats').then((r) => r.data),
    enabled: isActive,
    staleTime: 30_000,
  })

  if (!isActive) return null

  return (
    <div className="bg-white rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-text-secondary">{t('dashboard_widget.storage_used')}</span>
        <HardDrive size={16} style={{ color: '#f9ab00' }} />
      </div>
      <p className="text-2xl font-semibold text-text-primary">
        {stats ? formatSize(stats.storage_used) : '—'}
      </p>
    </div>
  )
}
