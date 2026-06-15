import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Type, ChevronDown } from 'lucide-react'
import { filesApi, type FileItem } from '@kubuno/drive'
import { api } from '@kubuno/sdk'
import { FloatingWindow } from '@ui'

// ── Font detection ─────────────────────────────────────────────────────────────

export function isFontFile(file: FileItem): boolean {
  const m   = file.mime_type.toLowerCase()
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return (
    m.startsWith('font/') ||
    m === 'application/x-font-ttf' ||
    m === 'application/x-font-otf' ||
    m === 'application/font-woff' ||
    m === 'application/font-woff2' ||
    m === 'application/vnd.ms-fontobject' ||
    ['ttf', 'otf', 'woff', 'woff2', 'eot'].includes(ext)
  )
}

// ── Specimen strings ───────────────────────────────────────────────────────────

const ALPHA_UP    = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const ALPHA_LO    = 'abcdefghijklmnopqrstuvwxyz'
const NUMS        = '0123456789'
const PUNCTUATION = '! ? @ # % & . , ; : ( ) [ ] { } " \' / \\ — …'

const SIZES = [12, 16, 24, 36, 48, 72] as const
type Size = typeof SIZES[number]

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  file:    FileItem
  onClose: () => void
}

export default function FilesFontViewer({ file, onClose }: Props) {
  const { t } = useTranslation('drive')
  const PANGRAM_FR = t('font.pangram_lat')
  const PANGRAM_EN = t('font.pangram_en')
  const fontFamily  = `kubuno-font-${file.id}`
  const [loaded,    setLoaded]    = useState(false)
  const [error,     setError]     = useState(false)
  const [size,      setSize]      = useState<Size>(36)
  const [sizeOpen,  setSizeOpen]  = useState(false)
  const fontRef = useRef<FontFace | null>(null)
  const sizeRef = useRef<HTMLDivElement>(null)

  // Fermer le sélecteur de taille au click en dehors
  useEffect(() => {
    if (!sizeOpen) return
    const handler = (e: MouseEvent) => {
      if (sizeRef.current && !sizeRef.current.contains(e.target as Node)) setSizeOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [sizeOpen])

  useEffect(() => {
    let cancelled = false
    // Octets récupérés via axios (token Bearer injecté) puis passés à FontFace en
    // BufferSource : un FontFace `url()` natif est fetché SANS l'en-tête Authorization
    // (les interceptors axios ne s'y appliquent pas) → 401, d'où la police qui ne
    // chargeait plus. Le buffer évite aussi la contrainte CSP font-src.
    api.get<ArrayBuffer>(`/drive/${file.id}/download`, { responseType: 'arraybuffer' })
      .then(async resp => {
        if (cancelled) return
        const loaded = await new FontFace(fontFamily, resp.data as ArrayBuffer).load()
        document.fonts.add(loaded)
        fontRef.current = loaded
        setLoaded(true)
      })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true; if (fontRef.current) document.fonts.delete(fontRef.current) }
  }, [file.id, fontFamily])

  const ext = file.name.split('.').pop()?.toUpperCase() ?? 'FONT'

  const titleActions = (
    <>
      {/* Size picker */}
      <div className="relative" ref={sizeRef}>
        <button
          onClick={() => setSizeOpen(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm
                     text-text-secondary hover:bg-surface-1"
        >
          <span>{size}px</span>
          <ChevronDown size={14} />
        </button>
        {sizeOpen && (
          <div className="absolute right-0 top-full mt-1 bg-white border border-border rounded-lg shadow-lg py-1 z-10 w-24">
            {SIZES.map(s => (
              <button
                key={s}
                onClick={() => { setSize(s); setSizeOpen(false) }}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-surface-1 ${
                  s === size ? 'text-primary font-medium' : 'text-text-primary'
                }`}
              >
                {s}px
              </button>
            ))}
          </div>
        )}
      </div>

      <a
        href={filesApi.downloadUrl(file.id)}
        download={file.name}
        className="p-2 text-text-tertiary hover:text-text-primary rounded-lg hover:bg-surface-1"
        title={t('common.download')}
      >
        <Download size={16} />
      </a>
    </>
  )

  return (
    <FloatingWindow
      title={
        <span className="flex items-center gap-2">
          <span className="font-semibold">{file.name}</span>
          <span className="text-xs text-text-tertiary font-normal">{ext} · {t('font.typeface')}</span>
        </span>
      }
      icon={<Type size={16} className="text-violet-600" />}
      onClose={onClose}
      defaultWidth={820}
      defaultHeight={680}
      resizable
      titleActions={titleActions}
    >
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {error && (
          <div className="flex flex-col items-center justify-center h-full text-text-tertiary gap-3">
            <Type size={40} className="opacity-30" />
            <p className="text-sm">{t('font.cannot_load')}</p>
          </div>
        )}

        {!error && !loaded && (
          <div className="flex items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!error && loaded && (
          <div style={{ fontFamily: `'${fontFamily}', serif` }}>

            {/* Large specimen */}
            <div className="mb-8">
              <p className="text-xs font-semibold text-text-tertiary uppercase tracking-widest mb-3">{t('font.preview')}</p>
              <p style={{ fontSize: size, lineHeight: 1.3 }} className="text-text-primary break-words">
                {PANGRAM_FR}
              </p>
              <p style={{ fontSize: Math.max(14, size * 0.6), lineHeight: 1.3, opacity: 0.55 }} className="text-text-primary mt-1 break-words">
                {PANGRAM_EN}
              </p>
            </div>

            <hr className="border-border mb-6" />

            {/* Alphabet */}
            <div className="mb-6">
              <p className="text-xs font-semibold text-text-tertiary uppercase tracking-widest mb-3">{t('font.alphabet')}</p>
              <p className="text-3xl tracking-wide text-text-primary leading-snug break-all">{ALPHA_UP}</p>
              <p className="text-3xl tracking-wide text-text-primary leading-snug break-all mt-1">{ALPHA_LO}</p>
            </div>

            {/* Numbers */}
            <div className="mb-6">
              <p className="text-xs font-semibold text-text-tertiary uppercase tracking-widest mb-3">{t('font.numbers')}</p>
              <p className="text-4xl tracking-widest text-text-primary">{NUMS}</p>
            </div>

            {/* Punctuation */}
            <div className="mb-6">
              <p className="text-xs font-semibold text-text-tertiary uppercase tracking-widest mb-3">{t('font.punctuation')}</p>
              <p className="text-2xl tracking-wide text-text-primary leading-loose">{PUNCTUATION}</p>
            </div>

            <hr className="border-border mb-6" />

            {/* Size waterfall */}
            <div>
              <p className="text-xs font-semibold text-text-tertiary uppercase tracking-widest mb-4">{t('font.size_cascade')}</p>
              {[12, 16, 24, 36, 48].map(s => (
                <div key={s} className="flex items-baseline gap-4 mb-2">
                  <span className="text-xs text-text-tertiary w-10 flex-shrink-0">{s}px</span>
                  <span style={{ fontSize: s, lineHeight: 1.4 }} className="text-text-primary">
                    {PANGRAM_FR}
                  </span>
                </div>
              ))}
            </div>

          </div>
        )}
      </div>
    </FloatingWindow>
  )
}
