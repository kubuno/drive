// Custom search bar for the Fonts view — registered into the core shell's search
// slot (useSearchStore) so it fully replaces the generic search pill while the
// Fonts view is mounted. Google-Fonts-like: a search field on the left and a
// compact "Trier par" (sort-by) button docked on the right.
import { useRef, useState } from 'react'
import clsx from 'clsx'
import { Search, X, ChevronDown, ArrowUpDown, Check, ShoppingBag } from 'lucide-react'
import { MenuDropdown, Tooltip, type MenuItem, type MenuDropdownPos } from '@ui'
import { useFontsUiStore, FONT_SORT_LABELS, type FontSort } from './fontsUiStore'

export default function FontsSearchBar() {
  const query      = useFontsUiStore(s => s.query)
  const setQuery   = useFontsUiStore(s => s.setQuery)
  const sort       = useFontsUiStore(s => s.sort)
  const setSort    = useFontsUiStore(s => s.setSort)
  const cartCount  = useFontsUiStore(s => s.cart.length)
  const cartOpen   = useFontsUiStore(s => s.cartOpen)
  const toggleCart = useFontsUiStore(s => s.toggleCart)

  const [focused, setFocused] = useState(false)
  const [menu, setMenu] = useState<MenuDropdownPos | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const isActive = focused || !!menu

  const openSortMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    // Right-align the menu under the button (MenuDropdown has no align option).
    setMenu({ top: r.bottom + 6, left: Math.max(8, r.right - 220), minWidth: 210 })
  }
  const sortItems: MenuItem[] = (Object.keys(FONT_SORT_LABELS) as FontSort[]).map(k => ({
    type: 'action',
    label: FONT_SORT_LABELS[k],
    icon: sort === k ? <Check size={15} /> : undefined,
    onClick: () => setSort(k),
  }))

  return (
    <div className="flex items-center gap-2 w-full">
      <div
        className="relative flex-1 min-w-0 transition-all"
        style={{
          background:   isActive ? '#ffffff' : '#eaeef5',
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
            className="group flex items-center gap-1.5 h-9 pl-3 pr-2.5 mr-1.5 rounded-full text-text-secondary hover:bg-[#e8f0fe] transition-colors flex-shrink-0"
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
      {/* Selection "bag" (Google-Fonts-style) — opens the download page, badges
          the number of selected families. */}
      <Tooltip label="Polices sélectionnées">
        <button
          onClick={toggleCart}
          aria-label="Polices sélectionnées"
          className={clsx('relative shrink-0 w-11 h-11 flex items-center justify-center rounded-full transition-colors',
            cartOpen ? 'bg-primary-light text-primary' : 'text-text-secondary hover:bg-[#e8f0fe]')}
        >
          <ShoppingBag size={20} />
          {cartCount > 0 && (
            <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[11px] font-semibold flex items-center justify-center">{cartCount}</span>
          )}
        </button>
      </Tooltip>
      {menu && <MenuDropdown pos={menu} onClose={() => setMenu(null)} items={sortItems} />}
    </div>
  )
}
