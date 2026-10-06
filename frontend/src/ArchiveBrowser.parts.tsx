/**
 * The parts of `ArchiveBrowser.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { useTranslation } from "react-i18next"
import { Folder, FileText, Download, ChevronRight, Image, Film, Music, type LucideIcon } from "lucide-react"
import { filesApi, formatSize, type ArchiveEntry } from "@kubuno/drive"
import { downloadSignedUrl } from "@kubuno/sdk"
import type { ArchiveBrowser } from './ArchiveBrowser'
function fileIcon(name: string): LucideIcon {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['jpg','jpeg','png','gif','webp','svg','avif','heic'].includes(ext)) return Image
  if (['mp4','mkv','mov','avi','webm'].includes(ext)) return Film
  if (['mp3','ogg','wav','flac','aac'].includes(ext)) return Music
  return FileText
}

function EntryRow({ entry, fileId, onNavigate }: {
  entry:      ArchiveEntry
  fileId:     string
  onNavigate: (path: string) => void
}) {
  const { t } = useTranslation('drive')
  if (entry.is_dir) {
    return (
      <tr
        onClick={() => onNavigate(entry.path)}
        className="cursor-pointer hover:bg-surface-1 transition-colors"
      >
        <td className="px-4 py-2">
          <span className="flex items-center gap-3">
            <Folder size={16} className="text-text-secondary flex-shrink-0" />
            <span className="text-text-primary">{entry.name}</span>
          </span>
        </td>
        <td className="px-4 py-2 text-right text-text-tertiary">—</td>
        <td className="px-2 py-2 text-right">
          <ChevronRight size={14} className="text-text-tertiary" />
        </td>
      </tr>
    )
  }

  const IconComp = fileIcon(entry.name)

  return (
    <tr className="hover:bg-surface-1 transition-colors group">
      <td className="px-4 py-2">
        <span className="flex items-center gap-3">
          <IconComp size={16} className="text-text-tertiary flex-shrink-0" />
          <span className="text-text-primary">{entry.name}</span>
        </span>
      </td>
      <td className="px-4 py-2 text-right text-text-tertiary text-xs">
        {formatSize(entry.size)}
      </td>
      <td className="px-2 py-2 text-right">
        <a
          href={filesApi.archiveFileUrl(fileId, entry.path)}
          download={entry.name}
          onClick={e => { e.stopPropagation(); e.preventDefault(); void downloadSignedUrl(filesApi.archiveFileUrl(fileId, entry.path), entry.name) }}
          title={t('common.download')}
          className="inline-flex items-center justify-center p-1 rounded
                     opacity-0 group-hover:opacity-100 hover:bg-surface-2 transition-all"
        >
          <Download size={13} className="text-text-secondary" />
        </a>
      </td>
    </tr>
  )
}
export { EntryRow }

export function Part1({ t, entries, file, navigate }: { t: NonNullable<ArchiveBrowser['tr']>; entries: NonNullable<ArchiveBrowser['entries']>; file: NonNullable<ArchiveBrowser['props']['file']>; navigate: ArchiveBrowser['navigate'] }) {
  return (
    <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-xs text-text-tertiary border-b border-border">
                      <th className="text-left font-normal px-4 py-2">{t('common.name')}</th>
                      <th className="text-right font-normal px-4 py-2 w-24">{t('common.size')}</th>
                      <th className="w-10 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(entry => (
                      <EntryRow
                        key={entry.path}
                        entry={entry}
                        fileId={file.id}
                        onNavigate={navigate}
                      />
                    ))}
                  </tbody>
                </table>
  )
}
