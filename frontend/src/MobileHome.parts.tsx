/**
 * The parts of `MobileHome.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { formatRelative, toDate } from "@kubuno/sdk"
import { lazy, Suspense } from "react"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { api } from "@kubuno/sdk"
import { Upload, Pencil, Trash2, Share2, Star, FolderPlus, RotateCcw, Copy, Move, Activity as ActivityIcon, Loader2, type LucideIcon } from "lucide-react"
import type { MobileHome } from './MobileHome'
const DriveApp = lazy(() => import('./DriveApp'))

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
                {verb} · {entry.user_display} · {formatRelative(toDate(entry.created_at))}
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
export { ActivityTab }

export function Part1({ t }: { t: NonNullable<MobileHome['tr']> }) {
  return (
    <Suspense fallback={
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-secondary">
                <Loader2 size={18} className="animate-spin" />{t('common.loading')}
              </div>
            }>
              <DriveApp suggestions />
            </Suspense>
  )
}
