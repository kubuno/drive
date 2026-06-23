import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, useAuthStore } from '@kubuno/sdk'
import { FolderOpen, Save, ArrowLeft, ExternalLink, Check, Info } from 'lucide-react'
import { Toggle, Button, Radio, RangeSlider } from '@ui'
import { useModulePrefs } from './userPrefs'
import FilesWebDavSettings from './FilesWebDavSettings'

// ── Per-user preferences (backend, cross-device via core users.preferences) ─────

interface DrivePrefs {
  view:          string   // 'grid' | 'list'
  density:       string   // 'compact' | 'normal' | 'comfortable'
  sort:          string   // 'name' | 'modified_desc' | 'size_desc' | 'type'
  showHidden:    boolean
  confirmDelete: boolean
}

const DEFAULT_PREFS: DrivePrefs = {
  view: 'grid', density: 'normal', sort: 'name',
  showHidden: false, confirmDelete: true,
}

// ── Mail-style layout helpers ───────────────────────────────────────────────────

function SettingsRow({ label, description, children }: {
  label: string; description?: string; children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-8 py-4 border-b border-[#e8eaed] last:border-0">
      <div className="w-60 flex-shrink-0">
        <p className="text-sm text-[#202124] font-normal">{label}</p>
        {description && <p className="text-xs text-text-tertiary mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function RadioGroup({ options, value, onChange }: {
  options: { value: string; label: string }[]; value: string; onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col items-start gap-2">
      {options.map(opt => (
        <Radio key={opt.value} checked={value === opt.value} onChange={() => onChange(opt.value)} label={opt.label} />
      ))}
    </div>
  )
}

// ── Préférences tab (per-user) ──────────────────────────────────────────────────

function PreferencesTab() {
  const { t } = useTranslation('drive')
  const { prefs: saved, update } = useModulePrefs<DrivePrefs>('drive', DEFAULT_PREFS)
  const [prefs, setPrefs] = useState<DrivePrefs>(saved)
  const [savedFlag, setSavedFlag] = useState(false)
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof DrivePrefs>(key: K, value: DrivePrefs[K]) =>
    setPrefs(p => ({ ...p, [key]: value }))

  const save = async () => {
    setBusy(true)
    try {
      await update(prefs)
      setSavedFlag(true)
      setTimeout(() => setSavedFlag(false), 2500)
    } finally { setBusy(false) }
  }

  return (
    <div>
      <SettingsRow
        label={t('drive_pref_view', { defaultValue: 'Affichage par défaut' })}
        description={t('drive_pref_view_desc', { defaultValue: 'Mode d\'affichage à l\'ouverture d\'un dossier.' })}
      >
        <RadioGroup
          value={prefs.view}
          onChange={v => set('view', v)}
          options={[
            { value: 'grid', label: t('drive_pref_view_grid', { defaultValue: 'Grille (vignettes)' }) },
            { value: 'list', label: t('drive_pref_view_list', { defaultValue: 'Liste (détails)' }) },
          ]}
        />
      </SettingsRow>

      <SettingsRow
        label={t('drive_pref_density', { defaultValue: 'Densité' })}
        description={t('drive_pref_density_desc', { defaultValue: 'Espacement des éléments dans la liste.' })}
      >
        <RadioGroup
          value={prefs.density}
          onChange={v => set('density', v)}
          options={[
            { value: 'compact',     label: t('drive_pref_density_compact',     { defaultValue: 'Compacte (plus d\'éléments)' }) },
            { value: 'normal',      label: t('drive_pref_density_normal',      { defaultValue: 'Normale' }) },
            { value: 'comfortable', label: t('drive_pref_density_comfortable', { defaultValue: 'Confortable (plus d\'espace)' }) },
          ]}
        />
      </SettingsRow>

      <SettingsRow label={t('drive_pref_sort', { defaultValue: 'Tri par défaut' })}>
        <RadioGroup
          value={prefs.sort}
          onChange={v => set('sort', v)}
          options={[
            { value: 'name',          label: t('drive_pref_sort_name',     { defaultValue: 'Nom (A → Z)' }) },
            { value: 'modified_desc', label: t('drive_pref_sort_modified', { defaultValue: 'Date de modification (récents d\'abord)' }) },
            { value: 'size_desc',     label: t('drive_pref_sort_size',     { defaultValue: 'Taille (plus volumineux d\'abord)' }) },
            { value: 'type',          label: t('drive_pref_sort_type',     { defaultValue: 'Type de fichier' }) },
          ]}
        />
      </SettingsRow>

      <SettingsRow
        label={t('drive_pref_hidden', { defaultValue: 'Fichiers cachés' })}
        description={t('drive_pref_hidden_desc', { defaultValue: 'Afficher les fichiers dont le nom commence par un point.' })}
      >
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Toggle checked={prefs.showHidden} onChange={() => set('showHidden', !prefs.showHidden)} />
          <span className="text-sm text-text-primary">{t('drive_pref_hidden_on', { defaultValue: 'Afficher les fichiers cachés' })}</span>
        </label>
      </SettingsRow>

      <SettingsRow
        label={t('drive_pref_confirm', { defaultValue: 'Suppression' })}
        description={t('drive_pref_confirm_desc', { defaultValue: 'Demander une confirmation avant de mettre des éléments à la corbeille.' })}
      >
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Toggle checked={prefs.confirmDelete} onChange={() => set('confirmDelete', !prefs.confirmDelete)} />
          <span className="text-sm text-text-primary">{t('drive_pref_confirm_on', { defaultValue: 'Confirmer avant de supprimer' })}</span>
        </label>
      </SettingsRow>

      <div className="pt-5 flex items-center gap-3">
        <Button onClick={save} loading={busy}>
          {savedFlag
            ? <><Check size={14} className="mr-1.5 inline" />{t('drive_settings_saved', { defaultValue: 'Enregistré' })}</>
            : t('drive_settings_save_changes', { defaultValue: 'Enregistrer les modifications' })}
        </Button>
        <Button variant="ghost" onClick={() => setPrefs(saved)}>
          {t('common.cancel', { defaultValue: 'Annuler' })}
        </Button>
      </div>
    </div>
  )
}

// ── WebDAV tab (per-user, reuses the existing FilesWebDavSettings component) ─────

function WebDavTab() {
  // FilesWebDavSettings ships its own card/header; render it directly. Its top
  // margin (`mt-8`) is harmless inside the tab content area.
  return <FilesWebDavSettings />
}

// ── Admin-only global settings (instance, via /admin/settings) ──────────────────

interface FilesSettings {
  'storage.default_quota_bytes': number
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
      <SettingsRow
        label={t('settings_page.quota_label')}
        description={t('drive_quota_desc', { defaultValue: 'Quota de stockage attribué par défaut à chaque utilisateur.' })}
      >
        <div className="flex items-center gap-3 max-w-md">
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
      </SettingsRow>

      <SettingsRow label={t('drive_quota_info_label', { defaultValue: 'À savoir' })}>
        <div className="flex items-start gap-2">
          <Info size={15} className="text-text-tertiary mt-0.5 shrink-0" />
          <p className="text-xs text-text-secondary">
            {t('settings_page.info_1')} <code className="font-mono bg-surface-2 px-1 rounded">files.max_upload_bytes</code>
            &nbsp;{t('settings_page.info_2')}
          </p>
        </div>
      </SettingsRow>

      <div className="pt-5 flex justify-end">
        <Button onClick={handleSave} disabled={!isDirty || save.isPending} icon={<Save size={15} />}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  )
}

function AboutTab() {
  const { t } = useTranslation('drive')
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-surface-1">
        <div className="w-10 h-10 rounded-xl bg-warning-light flex items-center justify-center shrink-0">
          <FolderOpen size={20} className="text-warning" />
        </div>
        <div>
          <p className="text-sm font-semibold text-text-primary">Kubuno Drive</p>
          <p className="text-xs text-text-tertiary">v0.1.0 · {t('settings_page.about_official', { defaultValue: 'Module officiel' })}</p>
        </div>
        <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">Rust</span>
      </div>
      <div className="px-5 py-4">
        <a href="https://github.com/kubuno/kubuno" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
          <ExternalLink size={13} /> github.com/kubuno/kubuno
        </a>
      </div>
    </div>
  )
}

// ── Main page (mail-style breadcrumb + tab bar) ─────────────────────────────────

type Tab = 'preferences' | 'webdav' | 'storage' | 'about'

export default function DriveSettingsPage() {
  const { t } = useTranslation('drive')
  const isAdmin = useAuthStore(s => s.user?.role === 'admin')
  const [tab, setTab] = useState<Tab>('preferences')

  // Admin-only tabs (instance-wide settings) are hidden for non-admins.
  const tabs: { id: Tab; label: string; adminOnly?: boolean }[] = [
    { id: 'preferences', label: t('drive_tab_preferences', { defaultValue: 'Préférences' }) },
    { id: 'webdav',      label: t('drive_tab_webdav', { defaultValue: 'WebDAV' }) },
    { id: 'storage',     label: t('drive_tab_storage', { defaultValue: 'Stockage' }), adminOnly: true },
    { id: 'about',       label: t('drive_tab_about', { defaultValue: 'À propos' }) },
  ]
  const visibleTabs = tabs.filter(tb => !tb.adminOnly || isAdmin)

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Breadcrumb header */}
      <div className="flex items-center gap-2 px-6 py-2.5 border-b border-[#e8eaed] flex-shrink-0" style={{ background: '#f8f9fa' }}>
        <Link to="/drive" className="flex items-center gap-1.5 text-sm text-[#1a73e8] hover:underline">
          <ArrowLeft size={14} />
          Drive
        </Link>
        <span className="text-text-tertiary text-sm">/</span>
        <div className="flex items-center gap-1.5">
          <FolderOpen size={15} className="text-text-secondary" />
          <span className="text-sm text-text-primary">{t('drive_settings_title', { defaultValue: 'Réglages' })}</span>
        </div>
      </div>

      {/* Tab bar (Gmail-style) */}
      <div className="flex items-end border-b border-[#e8eaed] px-4 flex-shrink-0 overflow-x-auto" style={{ background: '#fff' }}>
        {visibleTabs.map(tb => (
          <button key={tb.id} onClick={() => setTab(tb.id)}
            className={`px-4 py-3 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === tb.id ? 'border-[#1a73e8] text-[#1a73e8] font-medium' : 'border-transparent text-[#5f6368] hover:text-[#202124] hover:bg-[#f1f3f4]'}`}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-6">
          {tab === 'preferences' && <PreferencesTab />}
          {tab === 'webdav'  && <WebDavTab />}
          {tab === 'storage' && isAdmin && <StorageTab />}
          {tab === 'about'   && <AboutTab />}
        </div>
      </div>
    </div>
  )
}
