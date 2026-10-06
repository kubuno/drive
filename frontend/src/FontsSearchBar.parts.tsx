/**
 * The parts of `FontsSearchBar.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { cn } from "@ui"
import { Search, X, ChevronDown, ArrowUpDown, ShoppingBag } from "lucide-react"
import { MenuDropdown, Tooltip } from "@ui"
import { FONT_SORT_LABELS } from "./fontsUiStore"
import type { FontsSearchBar } from './FontsSearchBar'

export function Part1({ isActive, inputRef, query, setQuery, setFocused, openSortMenu, sort }: { isActive: NonNullable<FontsSearchBar['isActive']>; inputRef: NonNullable<FontsSearchBar['inputRef']>; query: NonNullable<FontsSearchBar['query']>; setQuery: NonNullable<FontsSearchBar['setQuery']>; setFocused: NonNullable<FontsSearchBar['setFocused']>; openSortMenu: FontsSearchBar['openSortMenu']; sort: NonNullable<FontsSearchBar['sort']> }) {
  return (
    <div
            className="relative flex-1 min-w-0 transition-all"
            style={{
              background:   isActive ? '#ffffff' : 'var(--color-search-bg)',
              boxShadow:    isActive ? '0 1px 3px rgba(0,0,0,0.2), 0 2px 6px rgba(0,0,0,0.1)' : 'none',
              border:       `1px solid ${isActive ? '#e0e0e0' : 'transparent'}`,
              borderRadius: '9999px',
            }}
          >
            <div className="flex items-center h-12 flex-shrink-0">
              <div className="pl-4 pr-2 flex-shrink-0">
                <Search size={20} className="text-text-secondary" />
              </div>
              <input
                ref={inputRef}
                type="search"
                value={query}
                placeholder="Rechercher des polices…"
                onChange={e => setQuery(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                className="flex-1 bg-transparent outline-none min-w-0 text-text-primary placeholder:text-text-tertiary"
              />
              {query && (
                <button
                  onMouseDown={e => { e.preventDefault(); setQuery(''); inputRef.current?.focus() }}
                  className="flex-shrink-0 px-1 text-text-tertiary hover:text-text-primary"
                  aria-label="Effacer"
                >
                  <X size={16} />
                </button>
              )}
              <div className="w-px h-6 mx-1 flex-shrink-0 bg-border" />
              {/* Sort-by button (Google-Fonts-style) */}
              <button
                onClick={openSortMenu}
                aria-label="Trier par"
                className="group flex items-center gap-1.5 h-9 pl-3 pr-2.5 mr-1.5 rounded-md text-text-secondary hover:bg-[#e8f0fe] transition-colors flex-shrink-0"
              >
                <ArrowUpDown size={16} className="hidden sm:block flex-shrink-0" />
                <span className="hidden sm:block text-left leading-tight">
                  <span className="block text-[10px] text-text-tertiary">Trier par</span>
                  <span className="block text-xs font-medium text-text-primary whitespace-nowrap">{FONT_SORT_LABELS[sort]}</span>
                </span>
                <ChevronDown size={16} className="flex-shrink-0" />
              </button>
            </div>
          </div>
  )
}

export function Part2({ toggleCart, cartOpen, cartCount }: { toggleCart: NonNullable<FontsSearchBar['toggleCart']>; cartOpen: NonNullable<FontsSearchBar['cartOpen']>; cartCount: NonNullable<FontsSearchBar['cartCount']> }) {
  return (
    <Tooltip label="Polices sélectionnées">
            <button
              onClick={toggleCart}
              aria-label="Polices sélectionnées"
              className={cn('relative shrink-0 w-11 h-11 flex items-center justify-center rounded-full transition-colors',
                cartOpen ? 'bg-primary-light text-primary' : 'text-text-secondary hover:bg-[#e8f0fe]')}
            >
              <ShoppingBag size={20} />
              {cartCount > 0 && (
                <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[11px] font-semibold flex items-center justify-center">{cartCount}</span>
              )}
            </button>
          </Tooltip>
  )
}

export function Part3({ menu, setMenu, sortItems }: { menu: NonNullable<FontsSearchBar['menu']>; setMenu: NonNullable<FontsSearchBar['setMenu']>; sortItems: NonNullable<FontsSearchBar['sortItems']> }) {
  return (
    <MenuDropdown pos={menu} onClose={() => setMenu(null)} items={sortItems} />
  )
}
