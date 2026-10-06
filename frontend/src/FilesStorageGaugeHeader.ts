/**
 * Code-behind of `FilesStorageGaugeHeader.kbview` (converted from `FilesStorageGaugeHeader.tsx` by @kubuno/views-migrate).
 */
import { type MouseEventArgs } from '@kubuno/views'
import { useNavigate, useLocation } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuthStore } from "@kubuno/sdk"
import { formatSize } from "@kubuno/drive"

import { ViewBase } from './FilesStorageGaugeHeader.kbview'
import * as __parts from './FilesStorageGaugeHeader.parts'

export class FilesStorageGaugeHeader extends ViewBase {
  tr!: FilesStorageGaugeHeaderStores['t']
  user!: FilesStorageGaugeHeaderStores['user']
  navigate!: FilesStorageGaugeHeaderStores['navigate']
  pathname!: string

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const { t } = useTranslation('drive')
    const { user } = useAuthStore()
    const navigate = useNavigate()
    const { pathname } = useLocation()
    return { t, user, navigate, pathname }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ tr: s.t, user: s.user, navigate: s.navigate, pathname: s.pathname })
  }

  get onDrive(): boolean {
    return this.pathname === '/drive' || this.pathname.startsWith('/drive/')
  }

  get pct(): number {
    if (!(!(!this.onDrive || !this.user || this.user.quota_bytes === 0))) return undefined as never
    return Math.min(100, Math.round((this.user.used_bytes / this.user.quota_bytes) * 100))
  }

  get barColor(): "bg-danger" | "bg-warning" | "bg-primary" {
    if (!(!(!this.onDrive || !this.user || this.user.quota_bytes === 0))) return undefined as never
    return this.pct > 90 ? 'bg-danger' :
    this.pct > 70 ? 'bg-warning' :
    'bg-primary'
  }

  get label(): string {
    if (!(!(!this.onDrive || !this.user || this.user.quota_bytes === 0))) return undefined as never
    return `${formatSize(this.user.used_bytes)} ${this.tr('storage.used_suffix', { quota: formatSize(this.user.quota_bytes) })}`
  }

  get show_case_1() {
    return !!(!this.onDrive || !this.user || this.user.quota_bytes === 0)
  }

  get show_main() {
    return !(!this.onDrive || !this.user || this.user.quota_bytes === 0)
  }

  get part1_props() {
    return this.memo('part1_props', [this.barColor, this.pct, this.onDrive, this.user], () => {
      if (!(!(!this.onDrive || !this.user || this.user.quota_bytes === 0))) return undefined as never
      return ({ barColor: this.barColor, pct: this.pct })
    })
  }

  /** A part of the screen still written in React (<div> with a computed style). */
  get Part1() {
    if (!(!(!this.onDrive || !this.user || this.user.quota_bytes === 0))) return undefined as never
    return __parts.Part1
  }

  get span_text() {
    return this.memo('span_text', [this.user, this.onDrive], () => {
      if (!(!(!this.onDrive || !this.user || this.user.quota_bytes === 0))) return undefined as never
      return String(formatSize(this.user.used_bytes)) + " / " + String(formatSize(this.user.quota_bytes))
    })
  }

  get used_text(): string {
    return this.user ? String(formatSize(this.user.used_bytes)) : ''
  }

  get quota_text(): string {
    return this.user ? String(formatSize(this.user.quota_bytes)) : ''
  }

  get tooltip() {
    if (!(!(!this.onDrive || !this.user || this.user.quota_bytes === 0))) return undefined as never
    return `${this.tr('storage.title')} — ${this.label}`
  }

  panel_click(_sender: unknown, _args: MouseEventArgs) {
    if (!(!(!this.onDrive || !this.user || this.user.quota_bytes === 0))) return undefined as never
    this.navigate('/drive/storage')
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type FilesStorageGaugeHeaderStores = ReturnType<FilesStorageGaugeHeader['useStores']>

export default FilesStorageGaugeHeader.component()
