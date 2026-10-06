/**
 * Code-behind of `FilesVideoPlayer.kbview` (converted from `FilesVideoPlayer.tsx` by @kubuno/views-migrate).
 */
import { type MouseEventArgs } from '@kubuno/views'
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { formatSize, type FileItem } from "@kubuno/drive"
import { useSignedUrl } from "@kubuno/sdk"
import { fileSourceUrl, isExternalFile } from "../services/externalPreview"

import { ViewBase } from './FilesVideoPlayer.kbview'
import * as __parts from './FilesVideoPlayer.parts'

export type FilesVideoPlayerProps = { file: FileItem; onClose: () => void }

export class FilesVideoPlayer extends ViewBase {
  tr!: FilesVideoPlayerStores['t']
  videoSrc!: string | undefined

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const { t } = useTranslation('drive')
    return { t }
  }

  /** The screen's hooks that read its members (run after the fields of `useStores()` are set). React's rules apply: `use()` runs them on every render. */
  useHooks() {
    const videoSrc = useSignedUrl(fileSourceUrl(this.props.file), { purpose: 'stream' })
    this.publish({ videoSrc })
    useEffect(() => {
      const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') this.props.onClose() }
      document.addEventListener('keydown', handler)
      return () => document.removeEventListener('keydown', handler)
    }, [this.props.onClose])
    return { videoSrc }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ tr: s.t })
    const h = this.useHooks()
    this.publish({ videoSrc: h.videoSrc })
  }

  get show_is_external_file_file() {
    return !isExternalFile(this.props.file)
  }

  get p_text() {
    if (!(!isExternalFile(this.props.file))) return undefined as never
    return formatSize(this.props.file.size_bytes)
  }

  get part1_props() {
    return this.memo('part1_props', [this.props, this.tr], () => ({ file: this.props.file, t: this.tr }))
  }

  /** A part of the screen still written in React (<a download>: attribute(s) without a .kbview property). */
  get Part1() {
    return __parts.Part1
  }

  get show_video_src() {
    return !!(this.videoSrc)
  }

  get part2_props() {
    return this.memo('part2_props', [this.videoSrc], () => {
      if (!(this.videoSrc)) return undefined as never
      return ({ videoSrc: this.videoSrc })
    })
  }

  /** A part of the screen still written in React (<video> has no .kbview element yet). */
  get Part2() {
    if (!(this.videoSrc)) return undefined as never
    return __parts.Part2
  }

  stack_click(_sender: unknown, _args: MouseEventArgs) {
    this.props.onClose?.()
  }

  stack_click2(_sender: unknown, args: MouseEventArgs) {
    const e = args.native as React.MouseEvent<HTMLDivElement, MouseEvent>
    e.stopPropagation()
  }

  panel_click(_sender: unknown, _args: MouseEventArgs) {
    this.props.onClose?.()
  }

  stack_click3(_sender: unknown, args: MouseEventArgs) {
    const e = args.native as React.MouseEvent<HTMLDivElement, MouseEvent>
    e.stopPropagation()
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type FilesVideoPlayerStores = ReturnType<FilesVideoPlayer['useStores']>

/** What `useHooks()` gives (the types of the fields it fills). */
export type FilesVideoPlayerHooks = ReturnType<FilesVideoPlayer['useHooks']>

export default FilesVideoPlayer.component()
