/**
 * Code-behind of `SearchResultRow.kbcontrol` (converted from `SearchResultRow.tsx` by @kubuno/views-migrate).
 */
import { type MouseEventArgs } from '@kubuno/views'
import { useTranslation } from "react-i18next"
import { filesApi, formatSize, type FileItem, type SearchHit } from "@kubuno/drive"
import { useImageCacheStore, useSignedUrl } from "@kubuno/sdk"

import { ViewBase } from './SearchResultRow.kbcontrol'
import * as __parts from './SearchResultRow.parts'

export function sanitizeSnippet(raw: string): string {
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped
    .replace(/&lt;b&gt;/g, '<b>')
    .replace(/&lt;\/b&gt;/g, '</b>')
}

export type SearchResultRowProps = { file: SearchHit; onOpen: (file: FileItem) => void }

export class SearchResultRow extends ViewBase {
  tr!: SearchResultRowStores['t']
  i18n!: SearchResultRowStores['i18n']
  thumbSrc!: string | undefined

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const { t, i18n } = useTranslation('drive')
    return { t, i18n }
  }

  /** The screen's hooks that read its members (run after the fields of `useStores()` are set). React's rules apply: `use()` runs them on every render. */
  useHooks() {
    const thumbVer = useImageCacheStore(s => s.global + (s.versions[this.props.file.id] ?? 0))
    const thumbSrc = useSignedUrl(thumbVer ? `${filesApi.thumbnailUrl(this.props.file.id)}?v=${thumbVer}` : filesApi.thumbnailUrl(this.props.file.id))
    this.publish({ thumbSrc })
    return { thumbVer, thumbSrc }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ tr: s.t, i18n: s.i18n })
    const h = this.useHooks()
    this.publish({ thumbSrc: h.thumbSrc })
  }

  get updated(): string {
    return new Date(this.props.file.updated_at).toLocaleDateString(this.i18n.language, {
    day: '2-digit', month: 'short', year: 'numeric',
  })
  }

  /** `<ThumbImg>`, rendered by a ReactHost. */
  get ThumbImg() {
    return __parts.ThumbImg
  }

  get thumb_img_props() {
    return this.memo('thumb_img_props', [this.props, this.thumbSrc], () => ({ file: this.props.file, src: this.thumbSrc, className: "w-9 h-9 object-cover rounded" }))
  }

  get show_file_match_kind() {
    return this.props.file.match_kind === 'semantic'
  }

  get text() {
    return this.props.file.folder_path && this.props.file.folder_path !== '/' ? this.props.file.folder_path : this.tr('nav.my_drive', { defaultValue: 'Mon Drive' })
  }

  get show_file_snippet() {
    return !!(this.props.file.snippet)
  }

  get part1_props() {
    return this.memo('part1_props', [this.props], () => {
      if (!(this.props.file.snippet)) return undefined as never
      return ({ file_snippet: this.props.file?.snippet })
    })
  }

  /** A part of the screen still written in React (<p dangerouslySetInnerHTML>: attribute(s) without a .kbview property). */
  get Part1() {
    if (!(this.props.file.snippet)) return undefined as never
    return __parts.Part1
  }

  get p_text() {
    return this.memo('p_text', [this.props, this.updated], () => [((v: unknown) => (v == null || typeof v === 'boolean' ? null : String(v)))(formatSize(this.props.file.size_bytes)), " · ", ((v: unknown) => (v == null || typeof v === 'boolean' ? null : String(v)))(this.updated)] as unknown as string)
  }

  get part2_props() {
    return this.memo('part2_props', [this.props, this.tr], () => ({ file: this.props.file, t: this.tr }))
  }

  /** A part of the screen still written in React (<a target rel>: attribute(s) without a .kbview property). */
  get Part2() {
    return __parts.Part2
  }

  panel_click(_sender: unknown, _args: MouseEventArgs) {
    this.props.onOpen(this.props.file)
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type SearchResultRowStores = ReturnType<SearchResultRow['useStores']>

/** What `useHooks()` gives (the types of the fields it fills). */
export type SearchResultRowHooks = ReturnType<SearchResultRow['useHooks']>

export default SearchResultRow.component()
