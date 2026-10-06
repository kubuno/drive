/**
 * The parts of `DriveImageSource.kbcontrol` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { type ImgHTMLAttributes } from "react"
import { LayoutGrid, List } from "lucide-react"
import { useSignedUrl } from "@kubuno/sdk"
import type { DriveImageSource } from './DriveImageSource'

function SignedImg({ src, ...rest }: { src: string } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>) {
  const signed = useSignedUrl(src)
  return signed ? <img src={signed} {...rest} /> : null
}
export { SignedImg }

export function Part1({ s, switchScope, on, t }: { s: NonNullable<DriveImageSource['rows_scopes']>[number]['s']; switchScope: DriveImageSource['switchScope']; on: NonNullable<DriveImageSource['rows_scopes']>[number]['on']; t: NonNullable<DriveImageSource['tr']> }) {
  return (
    <button key={s.id} onClick={() => switchScope(s.id)}
                  className="px-3 pb-2 pt-1 text-sm transition-colors"
                  style={{
                    color: on ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    fontWeight: on ? 500 : 400,
                    boxShadow: on ? 'inset 0 -2px 0 0 var(--color-primary)' : 'none',
                  }}>
                  {t(s.labelKey, { defaultValue: s.fallback })}
                </button>
  )
}

export function Part2({ setGrid, grid }: { setGrid: NonNullable<DriveImageSource['setGrid']>; grid: NonNullable<DriveImageSource['grid']> }) {
  return (
    <button onClick={() => setGrid(false)} title="Affichage en liste"
              className="p-1.5 rounded" style={{ color: grid ? 'var(--color-text-tertiary)' : 'var(--color-primary)' }}>
              <List size={16} />
            </button>
  )
}

export function Part3({ setGrid, grid }: { setGrid: NonNullable<DriveImageSource['setGrid']>; grid: NonNullable<DriveImageSource['grid']> }) {
  return (
    <button onClick={() => setGrid(true)} title="Affichage en grille"
              className="p-1.5 rounded" style={{ color: grid ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}>
              <LayoutGrid size={16} />
            </button>
  )
}
