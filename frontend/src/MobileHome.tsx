/**
 * Drive home (mobile) — the landing screen of the bottom-nav "Home" tab.
 *
 * Two tabs:
 *  · Suggestions — the recently-opened files. Rendered by DriveApp itself
 *    (`recent`), so opening a file, sorting, the kebab menu and the list/grid
 *    toggle are the SAME code as everywhere else in Drive; this screen only
 *    supplies the tab strip above it.
 *  · Activity — the account-wide feed (who did what to which item).
 *
 * Desktop users land on the regular explorer, so this route is reachable but
 * unremarkable there; the tab strip stays useful at any width.
 */
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api, getDateLocale } from '@kubuno/sdk'
import { formatDistanceToNow, parseISO } from 'date-fns'
import {
  Upload, Pencil, Trash2, Share2, Star, FolderPlus, RotateCcw, Copy, Move,
  Activity as ActivityIcon, Loader2, type LucideIcon,
} from 'lucide-react'

const DriveApp = lazy(() => import('./DriveApp'))

// ── Activity feed ─────────────────────────────────────────────────────────────
//
// Typed here rather than imported from `@kubuno/drive`: the published npm types
// (0.1.2) predate `filesApi.getUserActivity()`. At runtime the host resolves the
// real instance — this only keeps the module's typecheck honest. Replace with
// `filesApi.getUserActivity()` once @kubuno/drive 0.1.3 ships.
interface ActivityFeedEntry {
  id:           number
  user_display: string
  action:       string
  created_at:   string
  file_id:      string | null
  folder_id:    string | null
  item_name:    string | null
  mime_type:    string | null
}

async function fetchActivity(limit = 50): Promise<ActivityFeedEntry[]> {
  const r = await api.get<{ activities: ActivityFeedEntry[] }>('/drive/activity', { params: { limit } })
  return r.data.activities
}

/** Icon + colour per logged action. Unknown actions stay neutral rather than
 *  guessing — the log grows over time and a wrong icon reads as a wrong fact. */
const ACTION_ICONS: Record<string, { Icon: LucideIcon; className: string }> = {
  uploaded:     { Icon: Upload,     className: 'text-primary' },
  created:      { Icon: FolderPlus, className: 'text-primary' },
  renamed:      { Icon: Pencil,     className: 'text-text-secondary' },
  moved:        { Icon: Move,       className: 'text-text-secondary' },
  copied:       { Icon: Copy,       className: 'text-text-secondary' },
  shared:       { Icon: Share2,     className: 'text-success' },
  starred:      { Icon: Star,       className: 'text-yellow-500' },
  trashed:      { Icon: Trash2,     className: 'text-danger' },
  deleted:      { Icon: Trash2,     className: 'text-danger' },
  restored:     { Icon: RotateCcw,  className: 'text-text-secondary' },
  edited_paint: { Icon: Pencil,     className: 'text-text-secondary' },
}

function ActivityTab() {
  const { t } = useTranslation('drive')
  const { data, isLoading, isError } = useQuery({
    queryKey: ['drive-activity'],
    queryFn:  () => fetchActivity(50),
    staleTime: 30_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-secondary">
        <Loader2 size={18} className="animate-spin" />{t('common.loading')}
      </div>
    )
  }
  if (isError || !data?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
        <ActivityIcon size={44} className="text-text-tertiary opacity-40" />
        <p className="text-sm text-text-secondary">{t('activity.empty', { defaultValue: 'Aucune activité récente' })}</p>
      </div>
    )
  }

  return (
    <ul className="divide-y divide-border rounded-xl border border-border overflow-hidden bg-white">
      {data.map(entry => {
        const { Icon, className } = ACTION_ICONS[entry.action] ?? { Icon: ActivityIcon, className: 'text-text-tertiary' }
        const verb = t(`activity.action.${entry.action}`, { defaultValue: entry.action })
        return (
          <li key={entry.id} className="flex items-center gap-3 px-3 py-3">
            <span className={`shrink-0 w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center ${className}`}>
              <Icon size={17} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] text-text-primary truncate">
                {entry.item_name ?? t('activity.unknown_item', { defaultValue: 'Élément supprimé' })}
              </p>
              <p className="text-xs text-text-tertiary truncate">
                {verb} · {entry.user_display} · {formatDistanceToNow(parseISO(entry.created_at), { locale: getDateLocale(), addSuffix: true })}
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function MobileHome() {
  const { t } = useTranslation('drive')
  const [tab, setTab] = useState<'suggestions' | 'activity'>('suggestions')

  const tabs: { id: typeof tab; label: string }[] = [
    { id: 'suggestions', label: t('home.suggestions', { defaultValue: 'Suggestions' }) },
    { id: 'activity',    label: t('home.activity',    { defaultValue: 'Activité' }) },
  ]

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-white">
      {/* Tab strip — underlined, full-width halves (mirrors the mobile app). */}
      <div className="flex shrink-0 border-b border-border">
        {tabs.map(x => {
          const active = tab === x.id
          return (
            <button
              key={x.id}
              onClick={() => setTab(x.id)}
              className={`flex-1 h-12 text-[15px] transition-colors relative
                          ${active ? 'text-primary font-medium' : 'text-text-secondary'}`}
            >
              {x.label}
              {active && <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t bg-primary" />}
            </button>
          )
        })}
      </div>

      {tab === 'suggestions' ? (
        <Suspense fallback={
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-secondary">
            <Loader2 size={18} className="animate-spin" />{t('common.loading')}
          </div>
        }>
          <DriveApp recent />
        </Suspense>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          <ActivityTab />
        </div>
      )}
    </div>
  )
}
