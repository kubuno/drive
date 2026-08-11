import { useTranslation } from 'react-i18next'
import { History } from 'lucide-react'
import { formatSize, type FileItem } from '@kubuno/drive'
import { hasReclaimableHistory, versionBytes, versionCount, type FileVersionStats } from '../fileVersions'

/**
 * Marks a file whose earlier revisions are still on disk — and still charged to
 * the account's quota.
 *
 * This exists because the accounting is invisible without it. A person saves a
 * document twenty times, sees one file of 2 MB in the listing, and is billed for
 * 40. Every other surface that states the figure (the details panel, the item
 * menu, the storage page) has to be opened first, which only helps somebody who
 * already suspects there is something to look for. The badge is the one place
 * that tells people who do not.
 *
 * Deliberately inert: no click handler, no `pointer-events-none` either. A
 * handler here would take the `pointerdown` the card needs to start a marquee
 * selection, and suppressing pointer events would take away the tooltip that
 * carries the weight. Reclaiming the space stays where it can be confirmed
 * properly — the context menu and the details panel.
 */
export default function VersionBadge({
  file, variant,
}: {
  file: (FileItem & FileVersionStats) | FileVersionStats | null | undefined
  /** `overlay` sits on the grid card's preview; `inline` follows the name in a row. */
  variant: 'overlay' | 'inline'
}) {
  const { t } = useTranslation('drive')
  if (!hasReclaimableHistory(file)) return null

  const count = versionCount(file)
  const title = t('version.badge_title', {
    count,
    size: formatSize(versionBytes(file)),
  })

  // Solid surface rather than a translucent overlay: the badge lands on photo
  // thumbnails as often as on white icon backgrounds, and only an opaque chip
  // stays legible on both.
  const base =
    'inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-1 ' +
    'text-text-secondary font-medium shrink-0 select-none'

  return (
    <span
      title={title}
      aria-label={title}
      className={
        variant === 'overlay'
          ? `${base} absolute top-1 left-1 z-10 px-1.5 py-0.5 text-[10px] leading-none shadow-sm`
          : `${base} px-1 py-px text-[10px] leading-none`
      }
    >
      <History size={10} className="shrink-0" />
      {count}
    </span>
  )
}
