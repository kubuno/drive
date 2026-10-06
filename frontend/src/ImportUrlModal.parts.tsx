/**
 * The parts of `ImportUrlModal.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { Input } from "@ui"
import type { ImportUrlModal } from './ImportUrlModal'

export function Part1({ url, setUrl, t }: { url: NonNullable<ImportUrlModal['url']>; setUrl: NonNullable<ImportUrlModal['setUrl']>; t: NonNullable<ImportUrlModal['tr']> }) {
  return (
    <Input
                  type="url"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder={t('importurl.url_ph')}
                  autoFocus
                  required
                />
  )
}
