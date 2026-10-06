/**
 * Code-behind of `DuplicatesDialog.kbview` (converted from `DuplicatesDialog.tsx` by @kubuno/views-migrate).
 */
import { bind, type MouseEventArgs } from '@kubuno/views'
import { useEffect, useCallback } from "react"
import { api } from "@kubuno/sdk"
import { formatSize } from "@kubuno/drive"

import { ViewBase } from './DuplicatesDialog.kbview'
import * as __parts from './DuplicatesDialog.parts'

interface DupFile {
  id:         string
  name:       string
  size_bytes: number
  mime_type:  string
  folder_id:  string | null
  updated_at: string
}

interface DupGroup {
  content_hash: string
  count:        number
  wasted_bytes: number
  files:        DupFile[]
}

interface DuplicatesResponse {
  groups:       DupGroup[]
  total_wasted: number
}

interface Props {
  onClose:    () => void
  onChanged?: () => void // called after deletion to refresh the parent listing
}

export type { Props }

export class DuplicatesDialog extends ViewBase {
  @bind accessor groups: DupGroup[] = []
  @bind accessor totalWasted = 0
  @bind accessor loading = true
  @bind accessor deleting: Record<string, boolean> = {}
  trashFile!: (file: DupFile) => Promise<void>
  trashGroupDuplicates!: (group: DupGroup) => Promise<void>

  /** The screen's hooks that read its members (run after the fields of `useStores()` are set). React's rules apply: `use()` runs them on every render. */
  useHooks() {
    useEffect(() => {
      let cancelled = false
      this.loading = true
      api
        .get<DuplicatesResponse>('/drive/duplicates')
        .then(({ data }) => {
          if (cancelled) return
          this.groups = data.groups
          this.totalWasted = data.total_wasted
        })
        .catch(() => {
          if (cancelled) return
          this.groups = []
          this.totalWasted = 0
        })
        .finally(() => {
          if (!cancelled) this.loading = false
        })
      return () => {
        cancelled = true
      }
    }, [])
    const removeFiles = useCallback((ids: Set<string>) => {
      this.groups = ((prev) => {
        const next: DupGroup[] = []
        for (const g of prev) {
          const remaining = g.files.filter(f => !ids.has(f.id))
          if (remaining.length <= 1) continue
          next.push({ ...g, files: remaining, count: remaining.length })
        }
        return next
      })(this.groups)
      this.totalWasted = ((prev) => {
        let removed = 0
        for (const g of this.groups) {
          for (const f of g.files) {
            if (ids.has(f.id)) removed += f.size_bytes
          }
        }
        return Math.max(0, prev - removed)
      })(this.totalWasted)
    }, [this.groups])
    const onChanged = this.props.onChanged
    const trashFile = useCallback(async (file: DupFile) => {
      this.deleting = ({ ...this.deleting, [file.id]: true })
      try {
        await api.post(`/drive/${file.id}/trash`)
        removeFiles(new Set([file.id]))
        onChanged?.()
      } finally {
        this.deleting = ((prev) => {
          const { [file.id]: _removed, ...rest } = prev
          return rest
        })(this.deleting)
      }
    }, [removeFiles, onChanged])
    this.publish({ trashFile })
    const trashGroupDuplicates = useCallback(async (group: DupGroup) => {
      const targets = group.files.slice(1)
      if (targets.length === 0) return
      this.deleting = ((prev) => {
        const next = { ...prev }
        for (const f of targets) next[f.id] = true
        return next
      })(this.deleting)
      const done = new Set<string>()
      try {
        for (const f of targets) {
          await api.post(`/drive/${f.id}/trash`)
          done.add(f.id)
        }
      } finally {
        if (done.size > 0) {
          removeFiles(done)
          onChanged?.()
        }
        this.deleting = ((prev) => {
          const next = { ...prev }
          for (const f of targets) delete next[f.id]
          return next
        })(this.deleting)
      }
    }, [removeFiles, onChanged])
    this.publish({ trashGroupDuplicates })
    return { removeFiles, trashFile, trashGroupDuplicates }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const h = this.useHooks()
    this.publish({ trashFile: h.trashFile, trashGroupDuplicates: h.trashGroupDuplicates })
  }

  get show_loading_groups() {
    return !this.loading && this.groups.length > 0
  }

  get text() {
    if (!(!this.loading && this.groups.length > 0)) return undefined as never
    return this.groups.length > 1 ? 's' : ''
  }

  get span_text() {
    if (!(!this.loading && this.groups.length > 0)) return undefined as never
    return formatSize(this.totalWasted)
  }

  get text2() {
    if (!(!this.loading && this.groups.length > 0)) return undefined as never
    return this.totalWasted > 0 ? 's' : ''
  }

  get show_not_loading() {
    return !(this.loading)
  }

  get show_groups() {
    if (!(!(this.loading))) return undefined as never
    return this.groups.length === 0
  }

  get show_not_groups() {
    if (!(!(this.loading))) return undefined as never
    return !(this.groups.length === 0)
  }

  /** A part of the screen still written in React (<CheckCircle2 strokeWidth>: an icon attribute without a property). */
  get Part1() {
    return __parts.Part1
  }

  /** A part of the screen still written in React (a list inside a list (nested Repeater)). */
  get Part2() {
    if (!(!(this.loading)) || !(!(this.groups.length === 0))) return undefined as never
    return __parts.Part2
  }

  /** A part of the screen still written in React (<Button> with element children). */
  get Part3() {
    if (!(!(this.loading)) || !(!(this.groups.length === 0))) return undefined as never
    return __parts.Part3
  }

  /** The rows of the Repeater over `groups`. */
  get rows_groups() {
    return this.memo('rows_groups', [this.groups, this.loading, this.deleting, this.trashFile, this.trashGroupDuplicates], () => {
      if (!(!(this.loading)) || !(!(this.groups.length === 0))) return undefined as never
      return this.groups.map((group) => {
      return { group, part2_props: ((!(this.loading)) && (!(this.groups.length === 0))) ? ({ group: group, deleting: this.deleting, trashFile: this.trashFile }) : undefined, show_group_files: ((!(this.loading)) && (!(this.groups.length === 0))) ? (group.files.length > 1) : undefined, part3_props: ((!(this.loading)) && (!(this.groups.length === 0)) && (group.files.length > 1)) ? ({ trashGroupDuplicates: this.trashGroupDuplicates, group: group, deleting: this.deleting }) : undefined, key: group.content_hash }
    })
    })
  }

  get visible() {
    return this.memo('visible', [this.show_groups, this.show_not_loading], () => this.show_groups && this.show_not_loading)
  }

  get visible2() {
    return this.memo('visible2', [this.show_not_groups, this.show_not_loading], () => this.show_not_groups && this.show_not_loading)
  }

  panel_click(_sender: unknown, _args: MouseEventArgs) {
    this.props.onClose?.()
  }

  panel_click2(_sender: unknown, _args: MouseEventArgs) {
    this.props.onClose?.()
  }

  button_click(_sender: unknown, _args: MouseEventArgs) {
    this.props.onClose?.()
  }

}

/** What `useHooks()` gives (the types of the fields it fills). */
export type DuplicatesDialogHooks = ReturnType<DuplicatesDialog['useHooks']>

export default DuplicatesDialog.component()
