/**
 * Code-behind of `DriveMiniPanel.kbcontrol` (converted from `DriveMiniPanel.tsx` by @kubuno/views-migrate).
 */
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { filesApi, recentApi } from "@kubuno/drive"

import { ViewBase } from './DriveMiniPanel.kbcontrol'
import * as __parts from './DriveMiniPanel.parts.tsx'

export class DriveMiniPanel extends ViewBase {
  navigate!: DriveMiniPanelStores['navigate']
  recent!: DriveMiniPanelStores['recent']
  isLoading!: boolean
  starred!: DriveMiniPanelStores['starred']

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const navigate = useNavigate()
    const { data: recent = [], isLoading } = useQuery({
      queryKey: ['drive-mini-recent'],
      queryFn:  () => recentApi.list({ limit: 8 }),
    })
    const { data: starred = [] } = useQuery({
      queryKey: ['drive-mini-starred'],
      /* Positional signature — and only 5 parameters in the PUBLISHED @kubuno/drive
       * types, which lag the core source. Slicing here avoids making this panel wait
       * on a republication of the package. */
      queryFn:  () => filesApi.listFiles(null, true).then(r => r.files.slice(0, 8)),
    })
    return { navigate, recent, isLoading, starred }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ navigate: s.navigate, recent: s.recent, isLoading: s.isLoading, starred: s.starred })
  }

  get show_not_is_loading() {
    return !(this.isLoading)
  }

  get part1_props() {
    return this.memo('part1_props', [this.recent, this.memo, this.navigate, this.isLoading], () => {
      if (!(!(this.isLoading))) return undefined as never
      return ({ recent: this.recent, open: this.memo("open:bound", [], () => this.open.bind(this)) })
    })
  }

  /** A part of the screen still written in React (<Section> is no .kbview element (a local or dynamic component)). */
  get Part1() {
    if (!(!(this.isLoading))) return undefined as never
    return __parts.Part1
  }

  get show_starred() {
    if (!(!(this.isLoading))) return undefined as never
    return this.starred.length > 0
  }

  get part2_props() {
    return this.memo('part2_props', [this.starred, this.memo, this.navigate, this.isLoading], () => {
      if (!(!(this.isLoading)) || !(this.starred.length > 0)) return undefined as never
      return ({ starred: this.starred, open: this.memo("open:bound", [], () => this.open.bind(this)) })
    })
  }

  /** A part of the screen still written in React (<Section> is no .kbview element (a local or dynamic component)). */
  get Part2() {
    if (!(!(this.isLoading)) || !(this.starred.length > 0)) return undefined as never
    return __parts.Part2
  }

  open(f: { id: string }) {
    return this.navigate(`/drive?preview=${f.id}`)
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type DriveMiniPanelStores = ReturnType<DriveMiniPanel['useStores']>

export default DriveMiniPanel.component()
