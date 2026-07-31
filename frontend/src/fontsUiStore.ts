import { create } from 'zustand'

// UI state shared between the custom fonts search bar (mounted into the core
// shell header) and the FontsExplorer content view. Kept in a tiny store so the
// two separate React subtrees stay in sync (the header bar lives outside the
// module's own tree).
export type FontSort = 'name' | 'recent' | 'styles'

export const FONT_SORT_LABELS: Record<FontSort, string> = {
  name:   'Nom (A→Z)',
  recent: 'Récentes',
  styles: 'Nombre de styles',
}

interface FontsUiStore {
  query: string
  sort:  FontSort
  /** Selected family names (the "cart") — mirrored from FontsExplorer so the
   *  header bag can show the count. */
  cart:  string[]
  /** Whether the selection / download page is open. */
  cartOpen: boolean
  setQuery:    (q: string) => void
  setSort:     (s: FontSort) => void
  setCart:     (names: string[]) => void
  setCartOpen: (open: boolean) => void
  toggleCart:  () => void
  reset:       () => void
}

export const useFontsUiStore = create<FontsUiStore>((set) => ({
  query: '',
  sort:  'name',
  cart:  [],
  cartOpen: false,
  setQuery:    (query) => set({ query }),
  setSort:     (sort) => set({ sort }),
  setCart:     (cart) => set({ cart }),
  setCartOpen: (cartOpen) => set({ cartOpen }),
  toggleCart:  () => set((s) => ({ cartOpen: !s.cartOpen })),
  reset:       () => set({ query: '', sort: 'name', cart: [], cartOpen: false }),
}))
