// Selection / download page (Google-Fonts "cart"): the families the user has
// selected, with per-family remove + download, download-all, and a self-host
// embed-code panel. Reached from the bag button in the header search bar.
//
// Unlike Google Fonts (which links to fonts.googleapis.com), the embed code is
// self-hosted: @font-face rules point at the font files on the CURRENT Kubuno
// instance (location.origin), so nothing depends on Google.
import { useState } from 'react'
import { Trash2, Download, Code2, ArrowLeft, Copy, Check } from 'lucide-react'
import clsx from 'clsx'
import { Button, Tooltip } from '@ui'

export interface CartVariant { url: string; weight: number; italic: boolean; format: string }
export interface CartFamily {
  name: string
  styleCount: number
  cssFamily: string
  variants: CartVariant[]
}

const SAMPLE = 'Your cloud, your rules, your data, your way'

const absUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : `${window.location.origin}${u}`)

function embedCss(families: CartFamily[]): string {
  return families.flatMap(f => f.variants.map(v =>
`@font-face {
  font-family: '${f.name}';
  font-style: ${v.italic ? 'italic' : 'normal'};
  font-weight: ${v.weight};
  font-display: swap;
  src: url('${absUrl(v.url)}') format('${v.format}');
}`)).join('\n\n')
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ }
  }
  return (
    <div className="relative rounded-xl bg-surface-2 border border-border">
      <pre className="p-4 pb-12 overflow-x-auto text-xs leading-relaxed text-text-primary font-mono whitespace-pre">{code}</pre>
      <button onClick={copy} className="absolute bottom-2 right-2 flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs text-text-secondary hover:bg-white hover:text-text-primary">
        {copied ? <><Check size={15} className="text-green-600" />Copié</> : <><Copy size={15} />Copier</>}
      </button>
    </div>
  )
}

// ── Embed sub-view ────────────────────────────────────────────────────────────
function EmbedView({ families, onBack }: { families: CartFamily[]; onBack: () => void }) {
  const css = embedCss(families)
  const usage = families.map(f => `.${f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')} {\n  font-family: '${f.name}', sans-serif;\n}`).join('\n\n')
  return (
    <div className="max-w-4xl">
      <button onClick={onBack} className="flex items-center gap-2 text-text-secondary hover:text-text-primary mb-6">
        <ArrowLeft size={20} /><span className="text-3xl font-semibold text-text-primary">Code d’intégration</span>
      </button>
      <p className="text-[15px] text-text-secondary mb-6 max-w-2xl">
        Auto-hébergé : ces règles pointent vers les fichiers de polices de <span className="font-medium text-text-primary">votre</span> instance Kubuno ({window.location.host}) — aucune dépendance à un service externe.
      </p>
      <h3 className="text-sm font-medium text-text-primary mb-2">Collez dans une balise <code className="text-xs">&lt;style&gt;</code> ou une feuille CSS</h3>
      <CodeBlock code={css} />
      <h3 className="text-sm font-medium text-text-primary mt-8 mb-2">Puis appliquez la police</h3>
      <CodeBlock code={usage} />
    </div>
  )
}

// ── Download page ─────────────────────────────────────────────────────────────
export default function FontDownloadPage({ families, onRemove, onOpen, onDownloadFamily, onDownloadAll, onClearAll }: {
  families: CartFamily[]
  onRemove: (name: string) => void
  onOpen: (name: string) => void
  onDownloadFamily: (name: string) => void
  onDownloadAll: () => void
  onClearAll: () => void
}) {
  const [embed, setEmbed] = useState(false)

  if (families.length === 0) {
    return (
      <div className="max-w-6xl mx-auto flex flex-col items-center justify-center py-24 text-center gap-3">
        <Download size={40} className="text-text-tertiary opacity-30" />
        <p className="text-text-secondary">Aucune police sélectionnée.</p>
        <p className="text-text-tertiary text-xs">Sélectionnez des polices (clic sur les cartes) pour les télécharger ou les intégrer d’un coup.</p>
      </div>
    )
  }

  if (embed) return <div className="max-w-6xl mx-auto pb-16"><EmbedView families={families} onBack={() => setEmbed(false)} /></div>

  const fade = 'linear-gradient(to right, black 88%, transparent 100%)'
  return (
    <div className="max-w-6xl mx-auto pb-16">
      <h1 className="text-4xl font-semibold text-text-primary mb-8">{families.length} famille{families.length > 1 ? 's' : ''} sélectionnée{families.length > 1 ? 's' : ''}</h1>
      <div className="grid lg:grid-cols-[1fr_320px] gap-10 items-start">
        {/* List — min-w-0 so the nowrap specimen lines can't widen the column
            and push the sidebar off-screen. */}
        <div className="min-w-0">
          <div className="flex justify-end mb-2">
            <button onClick={onClearAll} className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-danger px-2 py-1"><Trash2 size={15} />Tout retirer</button>
          </div>
          <div className="divide-y divide-border">
            {families.map(f => (
              <div key={f.name} className="py-5">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <button onClick={() => onOpen(f.name)} className="flex items-baseline gap-2 min-w-0 text-left group">
                    <span className="text-[15px] font-medium text-text-primary group-hover:underline truncate">{f.name}</span>
                    <span className="text-xs text-text-tertiary whitespace-nowrap">{f.styleCount} style{f.styleCount > 1 ? 's' : ''}</span>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <Tooltip label="Retirer de la sélection">
                      <button onClick={() => onRemove(f.name)} className="w-9 h-9 flex items-center justify-center rounded-full text-text-secondary hover:bg-surface-2 hover:text-danger" aria-label="Retirer"><Trash2 size={17} /></button>
                    </Tooltip>
                    <Tooltip label="Télécharger">
                      <button onClick={() => onDownloadFamily(f.name)} className="w-9 h-9 flex items-center justify-center rounded-full text-text-secondary hover:bg-surface-2 hover:text-primary" aria-label="Télécharger"><Download size={17} /></button>
                    </Tooltip>
                  </div>
                </div>
                <p className="text-text-primary whitespace-nowrap overflow-hidden leading-tight"
                  style={{ fontFamily: f.cssFamily ? `'${f.cssFamily}', system-ui` : undefined, fontSize: 40, maskImage: fade, WebkitMaskImage: fade }}>
                  {SAMPLE}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar */}
        <div className="lg:sticky lg:top-4 rounded-2xl bg-primary-light/60 p-5 space-y-3">
          <Button variant="primary" className="w-full justify-center" icon={<Code2 size={16} />} onClick={() => setEmbed(true)}>Code d’intégration</Button>
          <Button variant="primary" className="w-full justify-center" icon={<Download size={16} />} onClick={onDownloadAll}>Tout télécharger ({families.length})</Button>
          <p className="text-xs text-text-tertiary text-center pt-1">Auto-hébergé sur votre instance Kubuno.</p>
        </div>
      </div>
    </div>
  )
}
