/**
 * The parts of `FontDownloadPage.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { useState } from "react"
import { Trash2, Download, ArrowLeft, Copy, Check } from "lucide-react"
import { Tooltip } from "@ui"
import type { FontDownloadPage } from './FontDownloadPage'
interface CartVariant { url: string; weight: number; italic: boolean; format: string }

interface CartFamily {
  name: string
  styleCount: number
  cssFamily: string
  variants: CartVariant[]
}

const absUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : `${window.location.origin}${u}`)

const SAMPLE = 'Your cloud, your rules, your data, your way'

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
export { CodeBlock }

function EmbedView({ families, onBack }: { families: CartFamily[]; onBack: () => void }) {
  const css = embedCss(families)
  const usage = families.map(f => `.${f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')} {\n  font-family: '${f.name}', sans-serif;\n}`).join('\n\n')
  // Google-Fonts-style endpoint of THIS instance: generates the @font-face
  // rules server-side (weight/stretch ranges read from the binaries).
  const css2Url = `${window.location.origin}/api/v1/drive/fonts/css2?${families
    .map(f => `family=${encodeURIComponent(f.name).replace(/%20/g, '+')}`)
    .join('&')}&display=swap`
  const linkSnippet = `<link rel="stylesheet" href="${css2Url}">`
  const importSnippet = `@import url('${css2Url}');`
  return (
    <div className="max-w-4xl">
      <button onClick={onBack} className="flex items-center gap-2 text-text-secondary hover:text-text-primary mb-6">
        <ArrowLeft size={20} /><span className="text-3xl font-semibold text-text-primary">Code d’intégration</span>
      </button>
      <p className="text-[15px] text-text-secondary mb-6 max-w-2xl">
        Auto-hébergé : ces règles pointent vers les polices de <span className="font-medium text-text-primary">votre</span> instance Kubuno ({window.location.host}) — aucune dépendance à un service externe.
      </p>
      <h3 className="text-sm font-medium text-text-primary mb-2">Dans le <code className="text-xs">&lt;head&gt;</code> de votre page</h3>
      <CodeBlock code={linkSnippet} />
      <h3 className="text-sm font-medium text-text-primary mt-8 mb-2">Ou en tête d’une feuille CSS</h3>
      <CodeBlock code={importSnippet} />
      <h3 className="text-sm font-medium text-text-primary mt-8 mb-2">Puis appliquez la police</h3>
      <CodeBlock code={usage} />
      <h3 className="text-sm font-medium text-text-primary mt-8 mb-2">Alternative sans l’endpoint : règles <code className="text-xs">@font-face</code> brutes</h3>
      <CodeBlock code={css} />
    </div>
  )
}
export { EmbedView }

export function Part1({ onRemove, f }: { onRemove: NonNullable<FontDownloadPage['props']['onRemove']>; f: NonNullable<FontDownloadPage['rows_families']>[number]['f'] }) {
  return (
    <Tooltip label="Retirer de la sélection">
                          <button onClick={() => onRemove(f.name)} className="w-9 h-9 flex items-center justify-center rounded-full text-text-secondary hover:bg-surface-2 hover:text-danger" aria-label="Retirer"><Trash2 size={17} /></button>
                        </Tooltip>
  )
}

export function Part2({ onDownloadFamily, f }: { onDownloadFamily: NonNullable<FontDownloadPage['props']['onDownloadFamily']>; f: NonNullable<FontDownloadPage['rows_families']>[number]['f'] }) {
  return (
    <Tooltip label="Télécharger">
                          <button onClick={() => onDownloadFamily(f.name)} className="w-9 h-9 flex items-center justify-center rounded-full text-text-secondary hover:bg-surface-2 hover:text-primary" aria-label="Télécharger"><Download size={17} /></button>
                        </Tooltip>
  )
}

export function Part3({ f, fade }: { f: NonNullable<FontDownloadPage['rows_families']>[number]['f']; fade: NonNullable<FontDownloadPage['fade']> }) {
  return (
    <p className="text-text-primary whitespace-nowrap overflow-hidden leading-tight"
                      style={{ fontFamily: f.cssFamily ? `'${f.cssFamily}', system-ui` : undefined, fontSize: 40, maskImage: fade, WebkitMaskImage: fade }}>
                      {SAMPLE}
                    </p>
  )
}
