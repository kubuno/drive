// Google-Fonts-like specimen page shown when a font family is opened. Four tabs:
// Specimen (hero + type tester + styles list + size ramp), About (description &
// designer, from the font's `name` table), License (copyright + license text),
// and Glyphs & languages (a character grid + supported scripts). Everything is
// rendered in the real font — each variant file is its own registered `FontFace`.
//
// Built from the shared @ui primitives (Tabs, Accordion, Dropdown, Input, Button,
// Tooltip) rather than hand-rolled controls.
import { useState } from 'react'
import { Trash2, RotateCcw, Download, Type, Info, FileText, Languages, Globe } from 'lucide-react'
import clsx from 'clsx'
import { Button, Tabs, Accordion, Dropdown, Input, Editable, Tooltip, type TabDef, type DropdownOption } from '@ui'

export interface SpecimenVariant {
  id: string
  cssFamily: string
  weight: number
  italic: boolean
}
export interface FontSpecimenData {
  name: string
  designer: string
  designerUrl?: string
  vendorUrl?: string
  category: string
  scripts: string[]
  version?: string
  copyright?: string
  description?: string
  license?: string
  licenseUrl?: string
  embeddable?: string
  variants: SpecimenVariant[]
}

type Tab = 'specimen' | 'about' | 'license' | 'glyphs'

const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular',
  500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black',
}
const weightName = (w: number) => WEIGHT_NAMES[Math.round(w / 100) * 100] ?? String(w)
const styleLabel = (v: SpecimenVariant) => `${weightName(v.weight)} ${v.weight}${v.italic ? ' Italic' : ''}`
const fontStack = (cssFamily: string) => (cssFamily ? `'${cssFamily}', system-ui` : 'system-ui')

const DEFAULT_PREVIEW = 'Your cloud, your rules, your data, your way'
const BODY_PARAGRAPH =
  'Everyone has the right to freedom of thought, conscience and religion; this right includes freedom to change one’s beliefs, and freedom, either alone or in community with others and in public or private, to manifest them.'

// Preset sizes offered by the size Dropdowns.
const SIZE_OPTS: DropdownOption[] = [12, 16, 20, 24, 28, 32, 40, 48, 64, 80, 96, 120].map(s => ({ value: String(s), label: `${s}px` }))

// Glyph groups shown in the Glyphs tab (a representative subset).
const GLYPH_GROUPS: { label: string; chars: string[] }[] = [
  { label: 'Minuscules latines', chars: [...'abcdefghijklmnopqrstuvwxyzàáâãäåāăąæçćĉčċďđèéêëēĕėęěìíîïĩīĭįıĵ'] },
  { label: 'Majuscules latines', chars: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZÀÁÂÃÄÅĀĂĄÆÇĆĈČĊĎĐÈÉÊËĒĔĖĘĚÌÍÎÏĨĪĬĮİ'] },
  { label: 'Chiffres', chars: [...'0123456789'] },
  { label: 'Ponctuation & symboles', chars: [...'.,;:!?¡¿…·—–-()[]{}«»“”‘’\'"@#&*/\\|<>+=~%°$€£¥©®™'] },
]

const withProto = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`)
const cleanUrl = (u: string) => u.replace(/^https?:\/\//i, '').replace(/\/$/, '')

// ── Specimen tab ─────────────────────────────────────────────────────────────
function SpecimenTab({ data }: { data: FontSpecimenData }) {
  const styles = [...data.variants].sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic))
  const rep = styles.find(v => v.weight === 400 && !v.italic) ?? styles[0]
  const [testerStyle, setTesterStyle] = useState<SpecimenVariant>(rep)
  const [testerSize, setTesterSize] = useState(40)
  const [stylesText, setStylesText] = useState('')
  const [stylesSize, setStylesSize] = useState(48)
  const previewText = stylesText.trim() || DEFAULT_PREVIEW
  const chips = [data.category, `${styles.length} style${styles.length > 1 ? 's' : ''}`, ...data.scripts].filter(Boolean)
  const styleOpts: DropdownOption[] = styles.map(v => ({ value: v.id, label: styleLabel(v) }))
  const RAMP = [48, 36, 32, 24, 18, 16]

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-6">
        {chips.map((c, i) => <span key={i} className="px-3 py-1.5 rounded-lg bg-surface-2 text-xs text-text-secondary">{c}</span>)}
      </div>
      {/* Hero */}
      <section className="border-t border-border py-8">
        <p className="text-text-primary leading-[1.05] break-words" style={{ fontFamily: fontStack(rep.cssFamily), fontSize: 'clamp(40px, 7vw, 96px)' }}>{DEFAULT_PREVIEW}</p>
      </section>
      {/* Type tester */}
      <section className="border-t border-border py-6">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Dropdown value={testerStyle.id} onChange={id => setTesterStyle(styles.find(v => v.id === id) ?? rep)} options={styleOpts} height={36} width={180} focusable />
          <Dropdown value={String(testerSize)} onChange={v => setTesterSize(Number(v))} options={SIZE_OPTS} height={36} width={104} focusable />
          <Tooltip label="Réinitialiser">
            <button onClick={() => { setTesterStyle(rep); setTesterSize(40) }} className="w-9 h-9 flex items-center justify-center rounded-full text-text-secondary hover:bg-surface-2"><RotateCcw size={16} /></button>
          </Tooltip>
        </div>
        <Editable
          defaultValue={`${DEFAULT_PREVIEW}. ${BODY_PARAGRAPH}`}
          className="rounded-xl p-5 min-h-[120px] leading-snug"
          style={{ fontFamily: fontStack(testerStyle.cssFamily), fontSize: testerSize, fontStyle: testerStyle.italic ? 'italic' : 'normal' }} />
      </section>
      {/* Styles */}
      <section className="border-t border-border py-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <h2 className="text-2xl font-semibold text-text-primary">Styles</h2>
          <div className="flex items-center gap-3">
            <Input value={stylesText} onChange={e => setStylesText(e.target.value)} placeholder="Tapez pour prévisualiser…" spellCheck={false} className="w-56 sm:w-72" />
            <Dropdown value={String(stylesSize)} onChange={v => setStylesSize(Number(v))} options={SIZE_OPTS} height={36} width={104} focusable />
          </div>
        </div>
        <div className="divide-y divide-border">
          {styles.map(v => (
            <div key={v.id} className="py-5">
              <p className="text-xs text-text-tertiary mb-1">{styleLabel(v)}</p>
              <p className="text-text-primary whitespace-nowrap overflow-hidden leading-tight"
                style={{ fontFamily: fontStack(v.cssFamily), fontSize: stylesSize, fontStyle: v.italic ? 'italic' : 'normal', maskImage: 'linear-gradient(to right, black 90%, transparent)', WebkitMaskImage: 'linear-gradient(to right, black 90%, transparent)' }}>
                {previewText}
              </p>
            </div>
          ))}
        </div>
      </section>
      {/* Size ramp */}
      <section className="border-t border-border py-6">
        <h2 className="text-2xl font-semibold text-text-primary mb-4">Tailles</h2>
        <div className="grid sm:grid-cols-2 gap-x-10 gap-y-6">
          {RAMP.map(sz => (
            <div key={sz}>
              <p className="text-xs text-text-tertiary mb-1">{weightName(rep.weight)} {rep.weight} à {sz}px</p>
              <p className="text-text-primary leading-snug break-words" style={{ fontFamily: fontStack(rep.cssFamily), fontSize: sz }}>{DEFAULT_PREVIEW}. {BODY_PARAGRAPH}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

// ── About tab ────────────────────────────────────────────────────────────────
function AboutTab({ data }: { data: FontSpecimenData }) {
  const facts: [string, string][] = [
    ['Styles', String(data.variants.length)],
    ['Catégorie', data.category],
    ['Écritures', data.scripts.join(', ') || '—'],
    ...(data.version ? [['Version', data.version.replace(/^Version\s*/i, '')] as [string, string]] : []),
    ...(data.embeddable ? [['Incorporation', data.embeddable] as [string, string]] : []),
  ]
  return (
    <div className="grid lg:grid-cols-[1.6fr_1fr] gap-10">
      <div className="min-w-0">
        <h2 className="text-3xl font-semibold text-text-primary mb-5">À propos</h2>
        {data.description
          ? <div className="text-[15px] text-text-secondary leading-relaxed whitespace-pre-line">{data.description}</div>
          : <p className="text-[15px] text-text-tertiary">Cette police ne fournit pas de description.</p>}
        {data.copyright && <p className="mt-6 text-xs text-text-tertiary whitespace-pre-line">{data.copyright}</p>}
        <div className="mt-8 pt-6 border-t border-border">
          <h3 className="text-xl font-semibold text-text-primary mb-3">Concepteur</h3>
          <p className="text-[15px] text-text-primary">{data.designer || 'Inconnu'}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {data.designerUrl && <a href={withProto(data.designerUrl)} target="_blank" rel="noreferrer" className="text-primary hover:underline">{cleanUrl(data.designerUrl)}</a>}
            {data.vendorUrl && <a href={withProto(data.vendorUrl)} target="_blank" rel="noreferrer" className="text-primary hover:underline">{cleanUrl(data.vendorUrl)}</a>}
          </div>
        </div>
      </div>
      <div>
        <dl className="rounded-xl border border-border divide-y divide-border overflow-hidden">
          {facts.map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-4 px-4 py-3">
              <dt className="text-xs text-text-tertiary shrink-0">{k}</dt>
              <dd className="text-xs text-text-primary text-right">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

// ── License tab ──────────────────────────────────────────────────────────────
function LicenseTab({ data }: { data: FontSpecimenData }) {
  const hasText = !!(data.license || data.copyright)
  return (
    <div className="grid lg:grid-cols-[1.6fr_1fr] gap-10">
      <div className="min-w-0">
        <h2 className="text-3xl font-semibold text-text-primary mb-5">Licence</h2>
        {data.copyright && <p className="text-xs text-text-secondary whitespace-pre-line mb-4">{data.copyright}</p>}
        {data.license
          ? <div className="text-xs text-text-secondary leading-relaxed whitespace-pre-line">{data.license}</div>
          : !data.copyright && <p className="text-[15px] text-text-tertiary">Cette police n’embarque pas de texte de licence.</p>}
        {data.licenseUrl && (
          <p className="mt-5 text-xs"><a href={withProto(data.licenseUrl)} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1.5"><Globe size={14} />{cleanUrl(data.licenseUrl)}</a></p>
        )}
      </div>
      <div>
        <p className="text-xs text-text-secondary leading-relaxed">
          {hasText
            ? 'Licence telle que déclarée dans les métadonnées de la police. Ceci n’est pas un conseil juridique — vérifiez la licence complète avant tout usage.'
            : 'Aucune information de licence n’est déclarée dans ce fichier de police.'}
        </p>
      </div>
    </div>
  )
}

// ── Glyphs & languages tab ───────────────────────────────────────────────────
function GlyphsTab({ data }: { data: FontSpecimenData }) {
  const rep = [...data.variants].sort((a, b) => a.weight - b.weight)[0]
  const family = fontStack(rep.cssFamily)
  const [selected, setSelected] = useState('a')

  const items = GLYPH_GROUPS.map(g => ({
    id: g.label,
    title: g.label,
    content: (
      <div className="grid grid-cols-10 gap-px bg-border">
        {g.chars.map((ch, i) => (
          <button key={i} onClick={() => setSelected(ch)}
            className={clsx('aspect-square flex items-center justify-center text-lg', selected === ch ? 'bg-primary text-white' : 'bg-white text-text-primary hover:bg-surface-2')}
            style={{ fontFamily: family }}>{ch}</button>
        ))}
      </div>
    ),
  }))

  return (
    <>
      <p className="text-[15px] text-text-secondary mb-6 max-w-2xl">Seul un sous-ensemble des glyphes est affiché ici. Téléchargez la police pour voir le jeu complet, ou essayez-la dans le testeur.</p>
      <div className="grid lg:grid-cols-[1fr_1fr] gap-8 items-start">
        <Accordion items={items} defaultOpen={[GLYPH_GROUPS[0].label]} />
        <div className="lg:sticky lg:top-4 flex items-center justify-center rounded-xl border border-border bg-white min-h-[280px] p-6">
          <span style={{ fontFamily: family, fontSize: 180, lineHeight: 1, color: 'var(--color-text-primary)' }}>{selected}</span>
        </div>
      </div>

      <section className="mt-10 pt-8 border-t border-border">
        <h2 className="text-3xl font-semibold text-text-primary">Prise en charge linguistique</h2>
        <p className="text-xs text-text-tertiary mt-1">{data.scripts.length} écriture{data.scripts.length > 1 ? 's' : ''} détectée{data.scripts.length > 1 ? 's' : ''}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {data.scripts.length ? data.scripts.map(s => (
            <span key={s} className="px-3 py-1.5 rounded-lg bg-surface-2 text-xs text-text-secondary">{s}</span>
          )) : <span className="text-xs text-text-tertiary">Non déclaré par la police.</span>}
        </div>
      </section>
    </>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
const TABS: TabDef<Tab>[] = [
  { id: 'specimen', label: 'Spécimen', icon: Type },
  { id: 'about', label: 'À propos', icon: Info },
  { id: 'license', label: 'Licence', icon: FileText },
  { id: 'glyphs', label: 'Glyphes & langues', icon: Languages },
]

export default function FontSpecimenPage({ data, onDelete, onDownload }: { data: FontSpecimenData; onDelete?: () => void; onDownload?: () => void }) {
  const [tab, setTab] = useState<Tab>('specimen')
  const rep = [...data.variants].sort((a, b) => a.weight - b.weight)[0]
  const link = data.vendorUrl || data.designerUrl

  return (
    <div className="max-w-6xl mx-auto pb-16">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 min-w-0"><Tabs tabs={TABS} value={tab} onChange={setTab} variant="pills" /></div>
        {onDownload && <Button variant="primary" size="sm" icon={<Download size={15} />} onClick={onDownload}>Télécharger</Button>}
      </div>

      <header className="pb-6">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-5xl sm:text-6xl font-semibold text-text-primary tracking-tight break-words" style={{ fontFamily: fontStack(rep.cssFamily) }}>{data.name}</h1>
          {onDelete && <Button variant="secondary" size="sm" icon={<Trash2 size={15} />} onClick={onDelete}>Supprimer</Button>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
          {data.designer && <span>Conçu par <span className="text-text-primary font-medium">{data.designer}</span></span>}
          {link && <a href={withProto(link)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline"><Globe size={14} />{cleanUrl(link)}</a>}
        </div>
      </header>

      {tab === 'specimen' && <SpecimenTab data={data} />}
      {tab === 'about' && <AboutTab data={data} />}
      {tab === 'license' && <LicenseTab data={data} />}
      {tab === 'glyphs' && <GlyphsTab data={data} />}
    </div>
  )
}
