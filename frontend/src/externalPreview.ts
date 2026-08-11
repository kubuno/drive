// Previewing content Drive does NOT own — mail attachments, chat files… The
// caller (another module, through `drive.openPreview`) hands over a plain URL;
// we wrap it into a synthetic `FileItem` so that EVERY Drive viewer (PDF,
// image, video, audio, text, 3D model, font) can render it unchanged.
//
// Two rules keep the drive-owned path byte-for-byte identical:
//   • `fileSourceUrl(file)` is the ONLY place that decides between the external
//     URL and Drive's `/drive/<id>/download` route;
//   • `isExternalFile(file)` gates every Drive-only affordance (rename, move,
//     share, labels, star, details, comments, versions, "open with"…), which is
//     hidden rather than removed.
import { filesApi, isTextFile, type FileItem } from '@kubuno/drive'
import { api, useAuthStore } from '@kubuno/sdk'

export interface ExternalSource {
  url:   string
  name:  string
  mime?: string
}

/** Synthetic ids carry this prefix; the real URL lives in `metadata`. */
const EXTERNAL_ID_PREFIX = 'external:'
const EXTERNAL_URL_KEY   = '__external_url'

let seq = 0

// ── MIME guessing ────────────────────────────────────────────────────────────
// Senders often ship `application/octet-stream` (or nothing at all), which
// would route every attachment to the "unsupported" branch. The extension is
// the more reliable signal, so it wins whenever the MIME is missing or generic.

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  ico: 'image/x-icon', heic: 'image/heic', tif: 'image/tiff', tiff: 'image/tiff',
  mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo', m4v: 'video/mp4',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav',
  flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/opus',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', obj: 'model/obj',
  stl: 'model/stl', ply: 'model/ply',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  eot: 'application/vnd.ms-fontobject',
  txt: 'text/plain', md: 'text/markdown', log: 'text/plain', csv: 'text/csv',
  json: 'application/json', xml: 'application/xml', yml: 'text/yaml', yaml: 'text/yaml',
  html: 'text/html', htm: 'text/html', css: 'text/css', ics: 'text/calendar',
}

const GENERIC_MIMES = new Set([
  '', 'application/octet-stream', 'binary/octet-stream', 'application/binary',
  'application/unknown', 'content/unknown',
])

export function extensionOf(name: string): string {
  const at = name.lastIndexOf('.')
  return at > 0 ? name.slice(at + 1).toLowerCase() : ''
}

/** Best-effort MIME for a (name, mime) pair; the extension wins when generic. */
export function guessMime(name: string, mime?: string): string {
  const declared = (mime ?? '').trim().toLowerCase()
  if (!GENERIC_MIMES.has(declared)) return declared
  return EXT_MIME[extensionOf(name)] ?? declared
}

// ── Synthetic FileItem ───────────────────────────────────────────────────────

/** Wraps an external source into a FileItem the Drive viewers understand. */
export function makeExternalFile(source: ExternalSource): FileItem {
  const now = new Date().toISOString()
  return {
    id:                 `${EXTERNAL_ID_PREFIX}${++seq}`,
    name:               source.name || 'document',
    folder_id:          null,
    size_bytes:         0,
    mime_type:          guessMime(source.name || '', source.mime),
    is_starred:         false,
    is_trashed:         false,
    has_thumbnail:      false,
    versioning_enabled: false,
    metadata:           { [EXTERNAL_URL_KEY]: source.url },
    owner_id:           '',
    created_at:         now,
    updated_at:         now,
  }
}

/** True when the item is an external source rather than a real Drive file. */
export function isExternalFile(file: { id: string } | null | undefined): boolean {
  return !!file && file.id.startsWith(EXTERNAL_ID_PREFIX)
}

/** The external URL carried by a synthetic file, or null for Drive files. */
export function externalUrlOf(file: FileItem): string | null {
  if (!isExternalFile(file)) return null
  const url = file.metadata?.[EXTERNAL_URL_KEY]
  return typeof url === 'string' ? url : null
}

/** Where the bytes live: the external URL, or Drive's download route. */
export function fileSourceUrl(file: FileItem): string {
  return externalUrlOf(file) ?? filesApi.downloadUrl(file.id)
}

/** Same as `fileSourceUrl`, but asks Drive to serve the file inline (no
 *  download counted). External URLs are returned untouched. */
export function fileInlineUrl(file: FileItem): string {
  const external = externalUrlOf(file)
  return external ?? `${filesApi.downloadUrl(file.id)}?inline=1`
}

// ── Byte fetching ────────────────────────────────────────────────────────────

/** Fetches a `Response` for any file. Drive files go through axios (Bearer
 *  token); external same-origin URLs get the token too, cross-origin ones are
 *  fetched with cookies only (an Authorization header would force a preflight). */
export async function fetchFileResponse(file: FileItem): Promise<Response> {
  const url = fileSourceUrl(file)
  const headers: Record<string, string> = {}
  if (isExternalFile(file)) {
    const sameOrigin = url.startsWith('/') || url.startsWith(window.location.origin)
    const token = useAuthStore.getState().accessToken
    if (sameOrigin && token) headers.Authorization = `Bearer ${token}`
  } else {
    const token = useAuthStore.getState().accessToken
    if (token) headers.Authorization = `Bearer ${token}`
  }
  const resp = await fetch(url, { headers, credentials: 'include' })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp
}

/** Bytes of any file (Drive or external) as an ArrayBuffer. */
export async function fetchFileBuffer(file: FileItem): Promise<ArrayBuffer> {
  if (!isExternalFile(file)) {
    const r = await api.get(`/drive/${file.id}/download`, { responseType: 'arraybuffer' })
    return r.data as ArrayBuffer
  }
  return (await fetchFileResponse(file)).arrayBuffer()
}

/** Bytes of any file (Drive or external) as a Blob — feeds FilesTextViewer. */
export async function fetchFileBlob(file: FileItem): Promise<Blob> {
  if (!isExternalFile(file)) return filesApi.downloadBlob(file.id)
  return (await fetchFileResponse(file)).blob()
}

// ── Viewer routing ───────────────────────────────────────────────────────────
// NB: the predicates below are intentionally self-contained rather than reusing
// `is3dFile` / `isFontFile`, which live next to the viewers themselves — those
// modules pull three.js in, and this file is imported by the module entry.

const MODEL_EXT  = ['glb', 'gltf', 'obj', 'stl', 'ply']
const MODEL_MIME = ['model/gltf-binary', 'model/gltf+json', 'model/obj', 'model/stl', 'model/ply']
const FONT_EXT   = ['ttf', 'otf', 'woff', 'woff2', 'eot']

export type PreviewKind = 'pdf' | 'image' | 'video' | 'audio' | 'font' | 'model3d' | 'text'

/** Which Drive viewer renders this (name, mime) pair — null when none does. */
export function previewKind(name: string, mime?: string): PreviewKind | null {
  const m   = guessMime(name, mime)
  const ext = extensionOf(name)
  if (m === 'application/pdf')                                 return 'pdf'
  if (m.startsWith('image/'))                                  return 'image'
  if (m.startsWith('video/'))                                  return 'video'
  if (m.startsWith('audio/'))                                  return 'audio'
  if (MODEL_MIME.includes(m) || MODEL_EXT.includes(ext))       return 'model3d'
  if (m.startsWith('font/') || FONT_EXT.includes(ext)
      || m === 'application/vnd.ms-fontobject')                return 'font'
  if (isTextFile({ name, mime_type: m }))                      return 'text'
  return null
}

/** Contract of `drive.canPreview`: can Drive render this in place? */
export function canPreview(mime = '', name = ''): boolean {
  return previewKind(name, mime) !== null
}
