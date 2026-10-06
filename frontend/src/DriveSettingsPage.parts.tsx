/**
 * The parts of `DriveSettingsPage.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import React, { useState } from "react"
import { useTranslation } from "react-i18next"
import { FolderOpen, ExternalLink, Check } from "lucide-react"
import { Toggle, Button, Radio, useSaveShortcut } from "@ui"
import { useModulePrefs } from "./userPrefs"
import { useIsMobile } from "./openable"
import FilesWebDavSettings from "./FilesWebDavSettings"
type DrivePrefs = {
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

function SettingsRow({ label, description, children }: {
  label: string; description?: string; children: React.ReactNode
}) {
  // The desktop row is a 240px label column + control beside it, which leaves
  // nothing for the control on a 390px screen. On mobile the label stacks above
  // a full-width control instead.
  const isMobile = useIsMobile()
  if (isMobile) {
    return (
      <div className="py-4 border-b border-[#e8eaed] last:border-0">
        <p className="text-[15px] text-[#202124]">{label}</p>
        {description && <p className="text-xs text-text-tertiary mt-0.5 leading-relaxed">{description}</p>}
        <div className="mt-3">{children}</div>
      </div>
    )
  }
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
export { SettingsRow }

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
export { RadioGroup }

function PreferencesTab() {
  const { t } = useTranslation('drive')
  const { prefs: saved, update } = useModulePrefs<DrivePrefs>('drive', DEFAULT_PREFS)
  const [prefs, setPrefs] = useState<DrivePrefs>(saved)
  const [savedFlag, setSavedFlag] = useState(false)
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof DrivePrefs>(key: K, value: DrivePrefs[K]) =>
    setPrefs(p => ({ ...p, [key]: value }))

  // Ctrl+S saves immediately (disabled while a save is in flight).
  useSaveShortcut(() => { void save() }, !busy)

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
export { PreferencesTab }

function WebDavTab() {
  // FilesWebDavSettings ships its own card/header; render it directly. Its top
  // margin (`mt-8`) is harmless inside the tab content area.
  return <FilesWebDavSettings />
}
export { WebDavTab }

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
export { AboutTab }
