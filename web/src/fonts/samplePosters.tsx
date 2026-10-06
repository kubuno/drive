// Sample-view "posters" for the fonts home — a Google-Fonts-like gallery where
// every family gets a distinct, colourful specimen poster. We can't ship the
// hand-designed art Google uses, so posters are generated from a template
// system: a palette (background/foreground/accent) crossed with a layout
// (arrangement of the family name + a small category label). Crossing ~12
// palettes with ~10 layouts yields 100+ stable variations; each family is
// mapped to one deterministically by hashing its name, so a font always shows
// the same poster while the gallery as a whole looks varied.
import type { CSSProperties, ReactNode } from 'react'

export interface PosterProps {
  name: string
  cssFamily?: string
  category: string
}

interface Palette { bg: string; fg: string; sub: string; ring?: string }

// Curated palettes — pastels, darks and a couple of gradients (Google-Fonts vibe).
const PALETTES: Palette[] = [
  { bg: '#f6c945', fg: '#173a2c', sub: '#4b6b3a' },
  { bg: '#ece6fb', fg: '#5a3fb0', sub: '#8271c0' },
  { bg: '#12212e', fg: '#4fd1c5', sub: '#8aa0af', ring: 'rgba(255,255,255,0.14)' },
  { bg: '#cfe0d3', fg: '#1f3d2f', sub: '#4f6b58' },
  { bg: '#fde0cf', fg: '#b4522a', sub: '#c9805c' },
  { bg: '#dbe8ff', fg: '#274bb5', sub: '#6f8fd6' },
  { bg: '#111827', fg: '#f3f4f6', sub: '#9ca3af', ring: 'rgba(255,255,255,0.14)' },
  { bg: '#fbe3ea', fg: '#a52f5e', sub: '#c86f8e' },
  { bg: '#e6f4ea', fg: '#1e7e3a', sub: '#5faf77' },
  { bg: '#fff3c4', fg: '#7a5c00', sub: '#a98f3e' },
  { bg: 'linear-gradient(135deg,#667eea,#764ba2)', fg: '#ffffff', sub: '#e3daf7', ring: 'rgba(255,255,255,0.2)' },
  { bg: 'linear-gradient(135deg,#f6d365,#fda085)', fg: '#5c2b00', sub: '#8a4a1f' },
  { bg: 'linear-gradient(135deg,#a8edea,#5b86a8)', fg: '#0d3b45', sub: '#2e6b74' },
  { bg: '#2b2320', fg: '#f4a259', sub: '#c9b8a8', ring: 'rgba(255,255,255,0.12)' },
]

const LAYOUT_COUNT = 10

export interface PosterTemplate { palette: number; layout: number }

// Full cross-product of palettes × layouts → 140 stable poster variations.
export const SAMPLE_POSTERS: PosterTemplate[] = PALETTES.flatMap((_, p) =>
  Array.from({ length: LAYOUT_COUNT }, (_, l) => ({ palette: p, layout: l })),
)

/** Stable string hash (djb2-ish) for deterministic poster assignment. */
function hash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Pick a stable poster template for a family name. */
export function pickPoster(name: string): PosterTemplate {
  return SAMPLE_POSTERS[hash(name) % SAMPLE_POSTERS.length]
}

const Sparkle = ({ color }: { color: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill={color} className="absolute bottom-3 right-3 opacity-70">
    <path d="M12 0l2.6 8.8L24 12l-9.4 3.2L12 24l-2.6-8.8L0 12l9.4-3.2z" />
  </svg>
)

/** Render one poster. `size` scales the whole thing for grid vs. larger uses. */
export function SamplePoster({ name, cssFamily, category, template }: PosterProps & { template?: PosterTemplate }) {
  const tpl = template ?? pickPoster(name)
  const p = PALETTES[tpl.palette]
  const fam: CSSProperties = { fontFamily: cssFamily ? `'${cssFamily}', system-ui` : 'system-ui', color: p.fg }
  const label = category.toUpperCase()
  const layout = tpl.layout

  const shell = 'relative overflow-hidden rounded-xl h-[210px] px-5 py-4 flex flex-col'
  const style: CSSProperties = { background: p.bg }

  const Label = ({ className = '' }: { className?: string }) => (
    <span className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${className}`} style={{ color: p.sub }}>{label}</span>
  )
  const Name = ({ size, className = '', style: extra }: { size: number; className?: string; style?: CSSProperties }) => (
    <span className={`block break-words leading-[0.98] ${className}`} style={{ ...fam, fontSize: size, ...extra }}>{name}</span>
  )

  // Each layout arranges the same pieces differently for visual variety.
  let content: ReactNode
  switch (layout) {
    case 0: // category top-left, big name bottom-left
      content = <><Label /><div className="flex-1" /><Name size={46} /></>
      break
    case 1: // centered name
      content = <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center"><Label /><Name size={42} className="text-center" /></div>
      break
    case 2: // huge name, top-aligned, clipped
      content = <><Name size={72} /><div className="flex-1" /><Label /></>
      break
    case 3: { // faint repeat behind + solid name
      content = (
        <div className="flex-1 flex flex-col justify-center">
          <Name size={40} style={{ opacity: 0.18 }} />
          <Name size={40} className="-mt-2" />
          <Label className="mt-2" />
        </div>
      )
      break
    }
    case 4: // outlined (stroke) name
      content = (
        <div className="flex-1 flex flex-col justify-end">
          <Label className="mb-2" />
          <Name size={54} style={{ color: 'transparent', WebkitTextStroke: `1.5px ${p.fg}` } as CSSProperties} />
        </div>
      )
      break
    case 5: // diagonal name
      content = (
        <div className="flex-1 flex items-center justify-center">
          <Name size={40} style={{ transform: 'rotate(-8deg)' }} className="text-center" />
        </div>
      )
      break
    case 6: // giant initial + name
      content = (
        <div className="flex-1 flex items-end gap-3">
          <span style={{ ...fam, fontSize: 96 }} className="leading-[0.8]">{name.charAt(0)}</span>
          <div className="pb-1"><Label /><Name size={26} className="mt-1" /></div>
        </div>
      )
      break
    case 7: // framed poster
      content = (
        <div className="flex-1 rounded-lg flex flex-col justify-between p-3" style={{ border: `1.5px solid ${p.ring ?? p.sub}` }}>
          <Label />
          <Name size={40} />
        </div>
      )
      break
    case 8: // name over a big soft circle
      content = (
        <>
          <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full" style={{ background: p.ring ?? 'rgba(0,0,0,0.06)' }} />
          <div className="relative flex-1 flex flex-col justify-end"><Label className="mb-2" /><Name size={46} /></div>
        </>
      )
      break
    default: // 9 — underline bars + name
      content = (
        <div className="flex-1 flex flex-col justify-center gap-2">
          <div className="h-1.5 w-10 rounded-full" style={{ background: p.fg }} />
          <Name size={44} />
          <Label />
        </div>
      )
  }

  return (
    <div className={shell} style={style}>
      {content}
      {(layout % 3 === 0) && <Sparkle color={p.fg} />}
    </div>
  )
}
