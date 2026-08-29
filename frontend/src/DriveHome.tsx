/**
 * Drive home — the landing screen (desktop), reachable from the sidebar's
 * "Accueil" entry and the mobile "Home" tab.
 *
 * It is a thin banner (a welcome line + quick filter chips) sitting above the
 * SHARED explorer fed a "suggestions" source: recently-modified, starred and
 * recently-shared files, plus the folders you last worked in — deliberately
 * distinct from « Récents » (the opened-file journal). Rendering the content
 * through `DriveApp suggestions` means the folder/file cards, view modes,
 * context menu and open behaviour are byte-for-byte the same as everywhere else
 * in Drive. The chips narrow the whole drive through the same store the header
 * search uses (no second search box — the header already has one).
 *
 * On phones it defers to the existing `MobileHome` (bottom-nav tabs).
 */
import { Suspense, lazy, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Loader2 } from 'lucide-react'
import { MenuDropdown, type MenuItem, type MenuDropdownPos } from '@ui'
import { useFilesStore, type FilesSearchFilters } from '@kubuno/drive'
import { useIsMobile } from './openable'
import MobileHome from './MobileHome'

const DriveApp = lazy(() => import('./DriveApp'))

/** A rounded filter chip that opens a menu of mutually-exclusive choices. */
function FilterChip({ label, active, onOpen }: {
  label: string; active: boolean; onOpen: (pos: MenuDropdownPos) => void
}) {
  return (
    <button
      type="button"
      onClick={e => {
        const r = e.currentTarget.getBoundingClientRect()
        onOpen({ top: r.bottom + 4, left: r.left, minWidth: 220 })
      }}
      className={`inline-flex items-center gap-1.5 h-9 pl-3.5 pr-2.5 rounded-md border text-sm transition-colors
                  ${active
                    ? 'border-primary/40 bg-primary-light text-primary'
                    : 'border-border text-text-secondary hover:bg-surface-2'}`}
    >
      <span>{label}</span>
      <ChevronDown size={16} className="opacity-70" />
    </button>
  )
}

function DesktopHome() {
  const { t } = useTranslation('drive')
  const navigate = useNavigate()
  const filters = useFilesStore(s => s.searchFilters)
  const [menu, setMenu] = useState<{ items: MenuItem[]; pos: MenuDropdownPos } | null>(null)
  const openMenu = (items: MenuItem[], pos: MenuDropdownPos) => setMenu({ items, pos })

  // A chip narrows the whole drive: set the filter, then hop to the results view.
  const applyFilter = useCallback((partial: Partial<FilesSearchFilters>) => {
    const s = useFilesStore.getState()
    s.setSearchFilters(partial)
    s.applySearch()
    navigate('/drive')
  }, [navigate])

  // Chip → menu items. `checked` mirrors the active filter.
  const chip = <K extends keyof FilesSearchFilters>(
    key: K, opts: Array<[FilesSearchFilters[K], string]>,
  ): MenuItem[] => opts.map(([value, label]) => ({
    type: 'action', label, checked: filters[key] === value,
    onClick: () => applyFilter({ [key]: value } as Partial<FilesSearchFilters>),
  }))

  const chips: Array<{ label: string; active: boolean; items: () => MenuItem[] }> = [
    {
      label: filters.type !== 'all' ? t(`filter.t_${filters.type}`) : t('filter.type'),
      active: filters.type !== 'all',
      items: () => chip('type', [
        ['all', t('filter.t_all')], ['folder', t('filter.t_folder')], ['document', t('filter.t_document')],
        ['spreadsheet', t('filter.t_spreadsheet')], ['presentation', t('filter.t_presentation')],
        ['pdf', t('filter.t_pdf')], ['image', t('filter.t_image')], ['video', t('filter.t_video')],
        ['audio', t('filter.t_audio')], ['archive', t('filter.t_archive')],
      ]),
    },
    {
      label: t('filter.owner'),
      active: filters.owner !== 'anyone',
      items: () => chip('owner', [
        ['anyone', t('filter.o_anyone')], ['me', t('filter.o_me')], ['notme', t('filter.o_notme')],
      ]),
    },
    {
      label: filters.modifiedDate !== 'anytime' ? t(`filter.d_${filters.modifiedDate}`) : t('filter.modified'),
      active: filters.modifiedDate !== 'anytime',
      items: () => chip('modifiedDate', [
        ['anytime', t('filter.d_anytime')], ['today', t('filter.d_today')], ['7days', t('filter.d_7days')],
        ['30days', t('filter.d_30days')], ['thisyear', t('filter.d_thisyear')], ['lastyear', t('filter.d_lastyear')],
      ]),
    },
    {
      label: filters.location !== 'everywhere' ? t('tree.my_drive') : t('filter.location'),
      active: filters.location !== 'everywhere',
      items: () => chip('location', [
        ['everywhere', t('filter.loc_everywhere')], ['mydrive', t('tree.my_drive')],
      ]),
    },
  ]

  return (
    <div className="flex flex-col h-full min-h-0 bg-surface">
      {/* Welcome banner + quick filter chips (no search box — the header owns search). */}
      <div className="shrink-0 px-6 pt-5 pb-3">
        <h1 className="text-[22px] text-text-primary">
          {t('home.welcome', { defaultValue: 'Bienvenue dans Drive' })}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {chips.map((c, i) => (
            <FilterChip key={i} label={c.label} active={c.active}
              onOpen={pos => openMenu(c.items(), pos)} />
          ))}
        </div>
      </div>

      {/* Suggested folders + files, rendered by the shared explorer (full width,
          identical cards to every other Drive view). */}
      <div className="flex-1 min-h-0">
        <Suspense fallback={
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-secondary">
            <Loader2 size={18} className="animate-spin" />{t('common.loading')}
          </div>
        }>
          <DriveApp suggestions />
        </Suspense>
      </div>

      {menu && <MenuDropdown items={menu.items} pos={menu.pos} onClose={() => setMenu(null)} />}
    </div>
  )
}

export default function DriveHome() {
  const isMobile = useIsMobile()
  return isMobile ? <MobileHome /> : <DesktopHome />
}
