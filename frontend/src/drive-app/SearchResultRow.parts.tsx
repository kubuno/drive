/**
 * The parts of `SearchResultRow.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { useState } from "react"
import { Download } from "lucide-react"
import { filesApi, getFileIcon, type FileItem } from "@kubuno/drive"
import { downloadSignedUrl } from "@kubuno/sdk"
import type { SearchResultRow } from './SearchResultRow'
function sanitizeSnippet(raw: string): string {
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped
    .replace(/&lt;b&gt;/g, '<b>')
    .replace(/&lt;\/b&gt;/g, '</b>')
}

function ThumbImg({ file, src, className }: { file: FileItem; src: string | undefined; className: string }) {
  const [err, setErr] = useState(false)
  const thumbable = file.mime_type.startsWith('image/') || file.mime_type.startsWith('video/')
  if (err || !thumbable) return <>{getFileIcon(file.mime_type, file.name)}</>
  if (!src) return null
  return <img src={src} alt={file.name} className={className} loading="lazy" onError={() => setErr(true)} />
}
export { ThumbImg }

export function Part1({ file_snippet }: { file_snippet: string }) {
  return (
    <p
                className="text-xs text-text-secondary mt-1 line-clamp-2 [&_b]:text-text-primary [&_b]:font-semibold"
                dangerouslySetInnerHTML={{ __html: sanitizeSnippet(file_snippet) }}
              />
  )
}

export function Part2({ file, t }: { file: NonNullable<SearchResultRow['props']['file']>; t: NonNullable<SearchResultRow['tr']> }) {
  return (
    <a
            href={filesApi.downloadUrl(file.id)}
            target="_blank"
            rel="noreferrer"
            className="flex-shrink-0 p-1.5 rounded hover:bg-surface-2 opacity-0 group-hover:opacity-100 transition-all"
            onClick={e => { e.stopPropagation(); e.preventDefault(); void downloadSignedUrl(filesApi.downloadUrl(file.id), file.name) }}
            aria-label={`${t('common.download')} ${file.name}`}
          >
            <Download size={14} className="text-text-secondary" />
          </a>
  )
}
