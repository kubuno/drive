/**
 * Code-behind of `TagInfoSection.kbview` (converted from `TagInfoSection.tsx` by @kubuno/views-migrate).
 */
import { useContext } from "react"
import { FileInfoExtraContext } from "@kubuno/drive"
import { useDriveExtras } from "./driveExtras"

import { ViewBase } from './TagInfoSection.kbview'
import * as __parts from './TagInfoSection.parts'

export class TagInfoSection extends ViewBase {
  target!: TagInfoSectionStores['target']
  tags!: TagInfoSectionStores['tags']
  assignments!: Record<string, string[]>
  toggleTag!: TagInfoSectionStores['toggleTag']

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const target      = useContext(FileInfoExtraContext)
    const tags        = useDriveExtras((s) => s.tags)
    const assignments = useDriveExtras((s) => s.assignments)
    const toggleTag   = useDriveExtras((s) => s.toggleTag)
    return { target, tags, assignments, toggleTag }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ target: s.target, tags: s.tags, assignments: s.assignments, toggleTag: s.toggleTag })
  }

  get assignedIds(): string[] {
    return this.memo('assignedIds', [this.assignments, this.target], () => {
      if (!(!(!this.target))) return undefined as never
      return this.assignments[this.target.id] ?? []
    })
  }

  get show_case_1() {
    return !!(!this.target)
  }

  get show_main() {
    return !(!this.target)
  }

  get show_tags() {
    if (!(!(!this.target))) return undefined as never
    return this.tags.length === 0
  }

  get show_not_tags() {
    if (!(!(!this.target))) return undefined as never
    return !(this.tags.length === 0)
  }

  /** A part of the screen still written in React (<button> with a computed style). */
  get Part1() {
    if (!(!(!this.target)) || !(!(this.tags.length === 0))) return undefined as never
    return __parts.Part1
  }

  /** The rows of the Repeater over `tags`. */
  get rows_tags() {
    return this.memo('rows_tags', [this.tags, this.assignedIds, this.target, this.toggleTag], () => {
      if (!(!(!this.target)) || !(!(this.tags.length === 0))) return undefined as never
      return this.tags.map((t) => {
      const on = this.assignedIds.includes(t.id)
      return { t, on, part1_props: ((!(!this.target)) && (!(this.tags.length === 0))) ? ({ t: t, toggleTag: this.toggleTag, target: this.target, on: on }) : undefined, key: t.id }
    })
    })
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type TagInfoSectionStores = ReturnType<TagInfoSection['useStores']>

export default TagInfoSection.component()
