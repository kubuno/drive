import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FolderOpen, File, FileText, Image, Music, Video, Archive, Code } from 'lucide-react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { getDateLocale } from '@kubuno/sdk'
import { filesApi, formatSize } from '@kubuno/drive'
import { DashboardWidget } from '@kubuno/sdk'
import type { LucideIcon } from 'lucide-react'

function fileIcon(mime: string): LucideIcon {
  if (mime.startsWith('image/'))       return Image
  if (mime.startsWith('video/'))       return Video
  if (mime.startsWith('audio/'))       return Music
  if (mime.startsWith('text/'))        return FileText
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('gzip')) return Archive
  if (mime.includes('javascript') || mime.includes('json') || mime.includes('xml')) return Code
  return File
}

function fileIconColor(mime: string): string {
  if (mime.startsWith('image/'))  return 'text-green-500'
  if (mime.startsWith('video/'))  return 'text-purple-500'
  if (mime.startsWith('audio/'))  return 'text-pink-500'
  if (mime.startsWith('text/'))   return 'text-blue-500'
  return 'text-text-tertiary'
}

export default function FilesRecentWidget() {
  const { t } = useTranslation('drive')
  const { data, isLoading } = useQuery({
    queryKey: ['widget-files-recent'],
    queryFn:  () => filesApi.listFiles(null, false, false, true),
    staleTime: 60_000,
  })

  const files = data?.files ?? []

  return (
    <DashboardWidget
      title={t('recent_widget.title')}
      icon={<FolderOpen size={15} className="text-text-secondary" />}
      link="/drive/recent"
    >
      {isLoading ? (
        <div className="px-4 py-6 text-center text-sm text-text-tertiary">{t('common.loading')}</div>
      ) : files.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-text-tertiary italic">
          {t('app.empty_recent')}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {files.map(f => {
            const Icon = fileIcon(f.mime_type)
            return (
              <li key={f.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-1 transition-colors">
                <Icon size={16} className={`shrink-0 ${fileIconColor(f.mime_type)}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{f.name}</p>
                  <p className="text-xs text-text-tertiary mt-0.5">
                    {formatSize(f.size_bytes)} · {formatDistanceToNow(parseISO(f.updated_at), { locale: getDateLocale(), addSuffix: true })}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </DashboardWidget>
  )
}
