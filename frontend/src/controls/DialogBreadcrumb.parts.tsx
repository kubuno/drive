/**
 * The parts of `DialogBreadcrumb.kbcontrol` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { MenuDropdown } from "@ui"
import type { DialogBreadcrumb } from './DialogBreadcrumb'

export function Part1({ items, menu_pos, menu }: { items: NonNullable<DialogBreadcrumb['items']>; menu_pos: NonNullable<NonNullable<DialogBreadcrumb['menu']>['pos']>; menu: NonNullable<DialogBreadcrumb['menu']> }) {
  return (
    <MenuDropdown items={items} pos={menu_pos} onClose={menu.close} minWidth={200} />
  )
}
