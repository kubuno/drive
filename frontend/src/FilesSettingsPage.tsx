import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@kubuno/sdk'
import { FolderOpen, Save, ChevronLeft, Info, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button, Tabs, RangeSlider } from '@ui'

type Tab = 'storage' | 'about'

interface FilesSettings {
  'storage.default_quota_bytes': number
}

function formatBytes(bytes: number, gbLabel: string, mbLabel: string): string {
  const gb = bytes / 1073741824
  if (gb >= 1) return `${gb % 1 === 0 ? gb : gb.toFixed(1)} ${gbLabel}`
  const mb = bytes / 1048576
  return `${mb % 1 === 0 ? mb : mb.toFixed(0)} ${mbLabel}`
}

function bytesFromGb(gb: number): number {
  return Math.round(gb * 1073741824)
}

function StorageTab() {
  const { t } = useTranslation('drive')
  const queryClient = useQueryClient()

  const { data: settings } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () =>
      api.get<{ settings: { key: string; value: unknown }[] }>('/admin/settings').then((r) => {
        const map: Record<string, unknown> = {}
        r.data.settings.forEach((s) => { map[s.key] = s.value })
        return map as unknown as FilesSettings
      }),
  })

  const defaultQuotaGb = settings ? (settings['storage.default_quota_bytes'] as number) / 1073741824 : 10
  const [defaultQuota, setDefaultQuota] = useState<number | null>(null)

  const save = useMutation({
    mutationFn: (updates: Record<string, unknown>) => api.patch('/admin/settings', updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-settings'] }),
  })

  function handleSave() {
    const updates: Record<string, unknown> = {}
    if (defaultQuota !== null) updates['storage.default_quota_bytes'] = bytesFromGb(defaultQuota)
    if (Object.keys(updates).length > 0) {
      save.mutate(updates, { onSuccess: () => setDefaultQuota(null) })
    }
  }

  const currentDefaultQuota = defaultQuota ?? defaultQuotaGb
  const isDirty = defaultQuota !== null

  return (
    <div>
      <div className="bg-white rounded-xl border border-border divide-y divide-border">
        <div className="p-5">
          <label className="block text-sm font-medium text-text-primary mb-1">
            {t('settings_page.quota_label')}
          </label>
          <p className="text-xs text-text-secondary mb-3">
            {t('settings_page.quota_desc', { current: formatBytes(bytesFromGb(currentDefaultQuota), t('common.gb'), t('common.mb')) })}
          </p>
          <div className="flex items-center gap-3">
            <RangeSlider
              min={1}
              max={100}
              step={1}
              value={currentDefaultQuota}
              onChange={(v) => setDefaultQuota(v)}
              className="flex-1"
              aria-label={t('settings_page.quota_label')}
            />
            <span className="text-sm font-medium text-text-primary w-16 text-right">
              {currentDefaultQuota} {t('common.gb')}
            </span>
          </div>
        </div>

        <div className="p-5 bg-surface-1">
          <div className="flex items-start gap-2">
            <Info size={15} className="text-text-tertiary mt-0.5 shrink-0" />
            <p className="text-xs text-text-secondary">
              {t('settings_page.info_1')} <code className="font-mono bg-surface-2 px-1 rounded">files.max_upload_bytes</code>
              &nbsp;{t('settings_page.info_2')}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button onClick={handleSave} disabled={!isDirty || save.isPending}>
          <Save size={15} />
          {save.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  )
}

function AboutTab() {
  const { t } = useTranslation('drive')
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-surface-1">
          <div className="w-10 h-10 rounded-xl bg-warning-light flex items-center justify-center shrink-0">
            <FolderOpen size={20} className="text-warning" />
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">Kubuno Files</p>
            <p className="text-xs text-text-tertiary">v0.1.0 · {t('settings_page.about_official')}</p>
          </div>
          <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
            Rust
          </span>
        </div>

        <div className="divide-y divide-border">
          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">{t('settings_page.about_desc_label')}</p>
            <p className="text-sm text-text-secondary leading-relaxed">
              {t('settings_page.about_desc')}
            </p>
          </div>

          <div className="px-5 py-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">{t('settings_page.about_author_label')}</p>
              <p className="text-sm text-text-primary">Kubuno Contributors</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">{t('settings_page.about_license_label')}</p>
              <p className="text-sm text-text-primary">AGPL-3.0</p>
            </div>
          </div>

          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-3">{t('settings_page.about_tech_label')}</p>
            <div className="flex flex-wrap gap-2">
              {['Rust', 'Axum 0.7', 'SQLx 0.8', 'PostgreSQL 16', 'tokio', 'argon2'].map(t => (
                <span key={t} className="text-xs px-2 py-1 rounded-lg bg-surface-2 text-text-secondary font-mono">{t}</span>
              ))}
            </div>
          </div>

          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">{t('settings_page.about_links_label')}</p>
            <a
              href="https://github.com/kubuno/kubuno"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <ExternalLink size={13} />
              github.com/kubuno/kubuno
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function FilesSettingsPage() {
  const { t } = useTranslation('drive')
  const [tab, setTab] = useState<Tab>('storage')

  const tabs: { id: Tab; label: string }[] = [
    { id: 'storage', label: t('settings_page.tab_storage') },
    { id: 'about',   label: t('settings_page.tab_about') },
  ]

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/admin?tab=modules" className="p-1.5 rounded-lg hover:bg-surface-2 text-text-secondary hover:text-text-primary transition-colors">
          <ChevronLeft size={18} />
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-warning-light flex items-center justify-center">
            <FolderOpen size={16} className="text-warning" />
          </div>
          <div>
            <h1 className="text-lg font-medium text-text-primary">{t('settings_page.title')}</h1>
            <p className="text-xs text-text-tertiary">{t('settings_page.subtitle')}</p>
          </div>
        </div>
      </div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-6" />

      {tab === 'storage' && <StorageTab />}
      {tab === 'about'   && <AboutTab />}
    </div>
  )
}
