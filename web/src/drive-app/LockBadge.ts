/**
 * Code-behind of `LockBadge.kbcontrol` (converted from `LockBadge.tsx` by @kubuno/views-migrate).
 */
import { useDriveExtras } from "../model/driveExtras"

import { ViewBase } from './LockBadge.kbcontrol'

export type LockBadgeProps = { fileId: string }

export class LockBadge extends ViewBase {
  locked!: boolean

  /** The screen's hooks that read its members (run after the fields of `useStores()` are set). React's rules apply: `use()` runs them on every render. */
  useHooks() {
    const locked = useDriveExtras(s => !!s.locks[this.props.fileId])
    this.publish({ locked })
    return { locked }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const h = this.useHooks()
    this.publish({ locked: h.locked })
  }

  get show_case_1() {
    return !!(!this.locked)
  }

  get show_main() {
    return !(!this.locked)
  }

}

/** What `useHooks()` gives (the types of the fields it fills). */
export type LockBadgeHooks = ReturnType<LockBadge['useHooks']>

export default LockBadge.component()
