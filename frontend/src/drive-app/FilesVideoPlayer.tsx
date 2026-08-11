import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, X } from 'lucide-react'
import { formatSize, type FileItem } from '@kubuno/drive'
import { fileSourceUrl, isExternalFile } from '../externalPreview'

// ── Built-in video player (fallback when the media module is not active) ──────

export default function FilesVideoPlayer({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const { t } = useTranslation('drive')
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col" onClick={onClose}>
      <div
        className="flex items-center justify-between px-4 py-3 bg-black/60 shrink-0"
        onClick={e => e.stopPropagation()}
      >
        <div>
          <p className="text-white text-sm font-medium truncate max-w-[60vw]">{file.name}</p>
          {/* An external source carries no Drive metadata — no size to show. */}
          {!isExternalFile(file) && <p className="text-white/50 text-xs">{formatSize(file.size_bytes)}</p>}
        </div>
        <div className="flex items-center gap-2">
          <a
            href={fileSourceUrl(file)}
            download={file.name}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
            onClick={e => e.stopPropagation()}
          >
            <Download size={14} />
            {t('common.download')}
          </a>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-white transition-colors">
            <X size={18} />
          </button>
        </div>
      </div>

      <div
        className="flex-1 flex items-center justify-center p-6"
        onClick={e => e.stopPropagation()}
      >
        <video
          src={fileSourceUrl(file)}
          controls
          autoPlay
          className="max-h-full max-w-full rounded-lg shadow-2xl"
          style={{ maxHeight: 'calc(100vh - 120px)' }}
        />
      </div>
    </div>
  )
}
