/**
 * The parts of `FilesStorageGaugeHeader.kbcontrol` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import type { FilesStorageGaugeHeader } from './FilesStorageGaugeHeader'

export function Part1({ barColor, pct }: { barColor: NonNullable<FilesStorageGaugeHeader['barColor']>; pct: NonNullable<FilesStorageGaugeHeader['pct']> }) {
  return (
    <div
              className={`h-full ${barColor} rounded-full transition-all duration-500`}
              style={{ width: `${pct}%` }}
            />
  )
}
