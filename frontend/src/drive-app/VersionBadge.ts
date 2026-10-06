/**
 * Code-behind of `VersionBadge.kbview` (converted from `VersionBadge.tsx` by @kubuno/views-migrate).
 */
import { useTranslation } from "react-i18next"
import { formatSize, type FileItem } from "@kubuno/drive"
import { hasReclaimableHistory, versionBytes, versionCount, type FileVersionStats } from "../fileVersions"

import { ViewBase } from './VersionBadge.kbview'

export type VersionBadgeProps = {
  file: (FileItem & FileVersionStats) | FileVersionStats | null | undefined
  /** `overlay` sits on the grid card's preview; `inline` follows the name in a row. */
  variant: 'overlay' | 'inline'
}

export class VersionBadge extends ViewBase {
  tr!: VersionBadgeStores['t']

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const { t } = useTranslation('drive')
    return { t }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ tr: s.t })
  }

  get count(): number {
    if (!(!(!hasReclaimableHistory(this.props.file)))) return undefined as never
    return versionCount(this.props.file)
  }

  get title(): string {
    if (!(!(!hasReclaimableHistory(this.props.file)))) return undefined as never
    return this.tr('version.badge_title', {
    count: this.count,
    size: formatSize(versionBytes(this.props.file)),
  })
  }

  get base(): string {
    if (!(!(!hasReclaimableHistory(this.props.file)))) return undefined as never
    return 'inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-1 ' +
    'text-text-secondary font-medium shrink-0 select-none'
  }

  get show_case_1() {
    return !!(!hasReclaimableHistory(this.props.file))
  }

  get show_main() {
    return !(!hasReclaimableHistory(this.props.file))
  }

  get span_class() {
    if (!(!(!hasReclaimableHistory(this.props.file)))) return undefined as never
    return this.props.variant === 'overlay'
          ? `${this.base} absolute top-1 left-1 z-10 px-1.5 py-0.5 text-[10px] leading-none shadow-sm`
          : `${this.base} px-1 py-px text-[10px] leading-none`
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type VersionBadgeStores = ReturnType<VersionBadge['useStores']>

export default VersionBadge.component()
