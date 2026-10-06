/**
 * The parts of `TagDots.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { tagColorHex } from "./driveExtras"
import type { TagDots } from './TagDots'

export function Part1({ t, size }: { t: NonNullable<TagDots['rows_items']>[number]['t']; size: NonNullable<TagDots['size']> }) {
  return (
    <span
              key={t.id}
              className="rounded-full ring-1 ring-black/5"
              style={{ width: size, height: size, backgroundColor: tagColorHex(t.color) }}
            />
  )
}
