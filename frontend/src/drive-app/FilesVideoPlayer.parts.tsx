/**
 * The parts of `FilesVideoPlayer.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { Download } from "lucide-react"
import { downloadSignedUrl } from "@kubuno/sdk"
import { fileSourceUrl } from "../externalPreview"
import type { FilesVideoPlayer } from './FilesVideoPlayer'

export function Part1({ file, t }: { file: NonNullable<FilesVideoPlayer['props']['file']>; t: NonNullable<FilesVideoPlayer['tr']> }) {
  return (
    <a
                href={fileSourceUrl(file)}
                download={file.name}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
                onClick={e => { e.stopPropagation(); e.preventDefault(); void downloadSignedUrl(fileSourceUrl(file), file.name) }}
              >
                <Download size={14} />
                {t('common.download')}
              </a>
  )
}

export function Part2({ videoSrc }: { videoSrc: NonNullable<FilesVideoPlayer['videoSrc']> }) {
  return (
    <video
                src={videoSrc}
                controls
                autoPlay
                className="max-h-full max-w-full rounded-lg shadow-2xl"
                style={{ maxHeight: 'calc(100vh - 120px)' }}
              />
  )
}
