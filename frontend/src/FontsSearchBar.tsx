/**
 * Code-behind of `FontsSearchBar.kbview` (converted from `FontsSearchBar.tsx` by @kubuno/views-migrate).
 */
import { bind } from '@kubuno/views'
import { useRef } from "react"
import { Check } from "lucide-react"
import { type MenuItem, type MenuDropdownPos } from "@ui"
import { useFontsUiStore, FONT_SORT_LABELS, type FontSort } from "./fontsUiStore"

import { ViewBase } from './FontsSearchBar.kbview'
import * as __parts from './FontsSearchBar.parts'

export class FontsSearchBar extends ViewBase {
  @bind accessor focused = false
  @bind accessor menu: MenuDropdownPos | null = null
  query!: string
  setQuery!: (q: string) => void
  sort!: FontSort
  setSort!: (s: FontSort) => void
  cartCount!: number
  cartOpen!: boolean
  toggleCart!: () => void
  inputRef!: FontsSearchBarStores['inputRef']

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const query      = useFontsUiStore(s => s.query)
    const setQuery   = useFontsUiStore(s => s.setQuery)
    const sort       = useFontsUiStore(s => s.sort)
    const setSort    = useFontsUiStore(s => s.setSort)
    const cartCount  = useFontsUiStore(s => s.cart.length)
    const cartOpen   = useFontsUiStore(s => s.cartOpen)
    const toggleCart = useFontsUiStore(s => s.toggleCart)
    const inputRef = useRef<HTMLInputElement>(null)
    return { query, setQuery, sort, setSort, cartCount, cartOpen, toggleCart, inputRef }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ query: s.query, setQuery: s.setQuery, sort: s.sort, setSort: s.setSort, cartCount: s.cartCount, cartOpen: s.cartOpen, toggleCart: s.toggleCart, inputRef: s.inputRef })
  }

  get isActive(): boolean {
    return this.focused || !!this.menu
  }

  get sortItems(): MenuItem[] {
    return this.memo('sortItems', [this.sort, this.setSort], () => (Object.keys(FONT_SORT_LABELS) as FontSort[]).map(k => ({
    type: 'action',
    label: FONT_SORT_LABELS[k],
    icon: this.sort === k ? <Check size={15} /> : undefined,
    onClick: () => this.setSort(k),
  })))
  }

  get part1_props() {
    return this.memo('part1_props', [this.isActive, this.inputRef, this.query, this.setQuery, this.memo, this.focused, this.menu, this.sort], () => ({ isActive: this.isActive, inputRef: this.inputRef, query: this.query, setQuery: this.setQuery, setFocused: this.memo("setFocused:bound", [], () => this.setFocused.bind(this)), openSortMenu: this.memo("openSortMenu:bound", [], () => this.openSortMenu.bind(this)), sort: this.sort }))
  }

  /** A part of the screen still written in React (<div> with a computed style). */
  get Part1() {
    return __parts.Part1
  }

  get part2_props() {
    return this.memo('part2_props', [this.toggleCart, this.cartOpen, this.cartCount], () => ({ toggleCart: this.toggleCart, cartOpen: this.cartOpen, cartCount: this.cartCount }))
  }

  /** A part of the screen still written in React (<ToolTip> label: no .kbview property). */
  get Part2() {
    return __parts.Part2
  }

  get show_menu() {
    return this.memo('show_menu', [this.menu], () => !!(this.menu))
  }

  get part3_props() {
    return this.memo('part3_props', [this.menu, this.memo, this.sortItems], () => {
      if (!(this.menu)) return undefined as never
      return ({ menu: this.menu, setMenu: this.memo("setMenu:bound", [], () => this.setMenu.bind(this)), sortItems: this.sortItems })
    })
  }

  /** A part of the screen still written in React (<ContextMenu> pos, onClose: no .kbview property). */
  get Part3() {
    if (!(this.menu)) return undefined as never
    return __parts.Part3
  }

  openSortMenu(e: React.MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    // Right-align the menu under the button (MenuDropdown has no align option).
    this.menu = { top: r.bottom + 6, left: Math.max(8, r.right - 220), minWidth: 210 }
  }

  /** `setFocused` of the TSX: a value, or an update of the previous one. */
  setFocused(value: FontsSearchBar['focused'] | ((prev: FontsSearchBar['focused']) => FontsSearchBar['focused'])) {
    this.focused = typeof value === 'function' ? (value as (prev: FontsSearchBar['focused']) => FontsSearchBar['focused'])(this.focused) : value
  }

  /** `setMenu` of the TSX: a value, or an update of the previous one. */
  setMenu(value: MenuDropdownPos | null | ((prev: MenuDropdownPos | null) => MenuDropdownPos | null)) {
    this.menu = typeof value === 'function' ? (value as (prev: MenuDropdownPos | null) => MenuDropdownPos | null)(this.menu) : value
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type FontsSearchBarStores = ReturnType<FontsSearchBar['useStores']>

export default FontsSearchBar.component()
