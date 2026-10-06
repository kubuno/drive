/**
 * Code-behind of `TagDots.kbview` (converted from `TagDots.tsx` by @kubuno/views-migrate).
 */
import { useMemo } from "react"
import { useDriveExtras, type Tag } from "./driveExtras"

import { ViewBase } from './TagDots.kbview'
import * as __parts from './TagDots.parts'

export type TagDotsProps = { itemId: string; max?: number; size?: number }

export class TagDots extends ViewBase {
  assignments!: Record<string, string[]>
  tags!: Tag[]
  itemTags!: Tag[]

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const assignments = useDriveExtras((s) => s.assignments)
    const tags = useDriveExtras((s) => s.tags)
    return { assignments, tags }
  }

  /** The screen's hooks that read its members (run after the fields of `useStores()` are set). React's rules apply: `use()` runs them on every render. */
  useHooks() {
    const tags = this.tags
    const itemTags = useMemo(() => {
      if (!this.ids?.length) return []
      const byId = new Map(tags.map((t) => [t.id, t]))
      return this.ids.map((id) => byId.get(id)).filter((t): t is Tag => !!t)
    }, [this.ids, tags])
    this.publish({ itemTags })
    return { itemTags }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ assignments: s.assignments, tags: s.tags })
    const h = this.useHooks()
    this.publish({ itemTags: h.itemTags })
  }

  get max() {
    return this.props.max ?? 4
  }

  get size() {
    return this.props.size ?? 8
  }

  get ids(): string[] {
    return this.memo('ids', [this.assignments, this.props], () => this.assignments[this.props.itemId])
  }

  get show_case_1() {
    return !!(!this.itemTags.length)
  }

  get show_main() {
    return !(!this.itemTags.length)
  }

  get tooltip() {
    if (!(!(!this.itemTags.length))) return undefined as never
    return this.itemTags.map((t) => t.name).join(', ')
  }

  /** A part of the screen still written in React (<span> with a computed style). */
  get Part1() {
    if (!(!(!this.itemTags.length))) return undefined as never
    return __parts.Part1
  }

  /** The rows of the Repeater over `itemTags.slice(0, max)`. */
  get rows_items() {
    return this.memo('rows_items', [this.itemTags, this.max, this.size], () => {
      if (!(!(!this.itemTags.length))) return undefined as never
      return this.itemTags.slice(0, this.max).map((t) => {
      return { t, part1_props: ((!(!this.itemTags.length))) ? ({ t: t, size: this.size }) : undefined, key: t.id }
    })
    })
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type TagDotsStores = ReturnType<TagDots['useStores']>

/** What `useHooks()` gives (the types of the fields it fills). */
export type TagDotsHooks = ReturnType<TagDots['useHooks']>

export default TagDots.component()
