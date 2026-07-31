// FontsExplorer — Windows-Fonts-like view for System/Fonts. Font files are stored
// flat (e.g. CALIBRI.TTF, CALIBRIB.TTF…); we parse each font's `name`/`OS/2`
// tables to group them by family, render an "Abg" preview in the real font, drill
// into a family to see its styles, and surface a Windows-style details bar.
// Supports import / delete and single + group selection with context menus.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, Type, Upload, Trash2, FolderOpen, Rows3, LayoutGrid, Image as ImageIcon } from 'lucide-react'
import clsx from 'clsx'
import { Button, FloatCheckbox, MenuDropdown, ConfirmDialog, ConflictDialog, Spinner, Tooltip, type ConflictChoice, type MenuItem, type MenuDropdownPos } from '@ui'
import { useConfirm, useSearchStore } from '@kubuno/sdk'
import { systemApi, useMarqueeSelection, type FileItem } from '@kubuno/drive'
import { parseFontMeta, styleLabelFr, styleSortKey, type FontMeta } from './fonts/fontMeta'
import { SamplePoster } from './fonts/samplePosters'
import FontSpecimenPage, { type FontSpecimenData } from './FontSpecimenPage'
import FontDownloadPage, { type CartFamily } from './FontDownloadPage'
import { useFontsUiStore } from './fontsUiStore'
import FontsSearchBar from './FontsSearchBar'

function fontFormat(name: string): string {
  const e = name.split('.').pop()?.toLowerCase() ?? ''
  return e === 'otf' ? 'opentype' : e === 'woff2' ? 'woff2' : e === 'woff' ? 'woff' : 'truetype'
}

interface FontEntry { file: FileItem; meta: FontMeta | null; cssFamily: string }
interface Family { name: string; variants: FontEntry[] }
// A card in the current view (family in root, single variant in family view).
interface DisplayItem { key: string; cssFamily: string; label: string; fileIds: string[]; stacked: boolean; family?: Family; variant?: FontEntry }

const FONT_RE = /\.(ttf|otf|ttc|woff2?|eot)$/i
const ACCEPT = '.ttf,.otf,.ttc,.woff,.woff2,.eot,font/*'
// Default specimen line (Kubuno's "your cloud, your rules" tagline) and size
// shown on the fonts home — same length as Google Fonts' classic specimen line.
const SAMPLE_TEXT = 'Your cloud, your rules, your data, your way'
const SPECIMEN_SIZE = 40

// Fonts-home layout, Google-Fonts-like: cards grid / full-width rows / big samples.
type FontViewMode = 'row' | 'grid' | 'sample'

function familyOf(e: FontEntry): string {
  return (e.meta?.family || e.file.name.replace(/\.[^.]+$/, '')).trim()
}
function repVariant(variants: FontEntry[]): FontEntry {
  return variants.find(v => /regular|normal|book/i.test(v.meta?.subfamily ?? ''))
    ?? [...variants].sort((a, b) => (a.meta?.weight ?? 400) - (b.meta?.weight ?? 400))[0]
    ?? variants[0]
}

export default function FontsExplorer({ folderId, onExit }: { folderId: string; onExit: () => void }) {
  const [entries, setEntries] = useState<FontEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  // The opened family lives in the URL (?font=<name>) so it survives a reload.
  const [params, setParams] = useSearchParams()
  const activeFamily = params.get('font')
  const setActiveFamily = useCallback((name: string | null) => {
    setParams(prev => {
      const p = new URLSearchParams(prev)
      if (name) p.set('font', name)
      else p.delete('font')
      return p
    })
  }, [setParams])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [ctx, setCtx] = useState<{ pos: MenuDropdownPos; keys: string[] } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()

  // Search + sort state, shared with the custom header search bar (FontsSearchBar).
  const query = useFontsUiStore(s => s.query)
  const sort  = useFontsUiStore(s => s.sort)
  const cartOpen    = useFontsUiStore(s => s.cartOpen)
  const setCartOpen = useFontsUiStore(s => s.setCartOpen)
  const [viewMode, setViewMode] = useState<FontViewMode>('grid')

  // Take over the core shell's search bar while the Fonts view is mounted. The
  // route is /drive/system (more specific than the drive's own /drive prefix, so
  // it wins resolveSearchConfig); unregistering on unmount restores drive search.
  useEffect(() => {
    useSearchStore.getState().register({
      moduleId:    'drive-fonts',
      routePrefix: '/drive/system',
      placeholder: 'Rechercher des polices…',
      SearchComponent: FontsSearchBar,
    })
    return () => {
      useSearchStore.getState().unregister('drive-fonts')
      useFontsUiStore.getState().reset()
    }
  }, [])

  // Marquee (rubber-band) selection over the cards (detected via data-selectable-id).
  const handleMarquee = useCallback((ids: Set<string>, additive: boolean) => {
    setSelected(additive ? prev => new Set([...prev, ...ids]) : ids)
  }, [])
  const { containerRef, marqueeStyle, preSelectedIds, onPointerDown, onPointerMove, onPointerUp, onPointerCancel } = useMarqueeSelection(handleMarquee)

  // Drag & drop import.
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounter = useRef(0)
  // Files whose name already exists → ask the user (overwrite / keep both / cancel).
  const [conflicts, setConflicts] = useState<File[]>([])

  const reload = async () => {
    let files: FileItem[] = []
    try { files = (await systemApi.listFiles(folderId)).files } catch { /* ignore */ }
    const fontFiles = files.filter(f => FONT_RE.test(f.name) || f.mime_type.startsWith('font/'))
    const faces: FontFace[] = []
    const loaded = await Promise.all(fontFiles.map(async (f): Promise<FontEntry> => {
      try {
        const buf = await (await systemApi.downloadBlob(f.id)).arrayBuffer()
        const meta = parseFontMeta(buf)
        const cssFamily = `kbfont-${f.id}`
        try { const face = await new FontFace(cssFamily, buf).load(); document.fonts.add(face); faces.push(face) } catch { /* preview falls back */ }
        return { file: f, meta, cssFamily }
      } catch { return { file: f, meta: null, cssFamily: '' } }
    }))
    return loaded
  }

  useEffect(() => {
    let cancelled = false
    const registered: FontFace[] = []
    setLoading(true)
    reload().then(loaded => { if (!cancelled) { setEntries(loaded); setLoading(false) } })
    return () => { cancelled = true; registered.forEach(face => { try { document.fonts.delete(face) } catch { /* ignore */ } }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId])

  const refresh = async () => { setEntries(await reload()) }

  const families = useMemo<Family[]>(() => {
    const map = new Map<string, FontEntry[]>()
    for (const e of entries) {
      const fam = familyOf(e)
      if (!map.has(fam)) map.set(fam, [])
      map.get(fam)!.push(e)
    }
    return [...map.entries()]
      .map(([name, variants]) => ({ name, variants: variants.sort((a, b) => styleSortKey(a.meta?.subfamily ?? '') - styleSortKey(b.meta?.subfamily ?? '')) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  }, [entries])

  const current = (activeFamily ? families.find(f => f.name === activeFamily) : null) ?? null

  // Root view: filter by the search query and reorder per the chosen sort.
  const displayFamilies = useMemo<Family[]>(() => {
    const q = query.trim().toLowerCase()
    const famTime = (f: Family) =>
      Math.max(0, ...f.variants.map(v => Date.parse(v.file.created_at ?? v.file.updated_at ?? '') || 0))
    let list = q ? families.filter(f => f.name.toLowerCase().includes(q)) : families
    list = [...list]
    if (sort === 'styles')      list.sort((a, b) => b.variants.length - a.variants.length || a.name.localeCompare(b.name, 'fr'))
    else if (sort === 'recent') list.sort((a, b) => famTime(b) - famTime(a) || a.name.localeCompare(b.name, 'fr'))
    else                        list.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    return list
  }, [families, query, sort])

  // Items shown in the current view (drives selection + details + delete).
  const items = useMemo<DisplayItem[]>(() => {
    if (current) {
      return current.variants.map(v => ({
        key: v.file.id, cssFamily: v.cssFamily, fileIds: [v.file.id], stacked: false, variant: v,
        label: `${current.name} ${styleLabelFr(v.meta?.subfamily ?? 'Normal')}`,
      }))
    }
    return displayFamilies.map(f => {
      const r = repVariant(f.variants)
      return { key: f.name, cssFamily: r.cssFamily, label: f.name, fileIds: f.variants.map(v => v.file.id), stacked: f.variants.length > 1, family: f }
    })
  }, [current, displayFamilies])

  // Keep the selection across home ↔ specimen navigation so the "cart" persists;
  // just drop the keyboard focus anchor.
  useEffect(() => { setFocusKey(null) }, [activeFamily])

  // The selection IS the download "cart" — mirror the selected family names to the
  // shared store so the header bag can badge the count (only valid families).
  useEffect(() => {
    useFontsUiStore.getState().setCart(families.filter(f => selected.has(f.name)).map(f => f.name))
  }, [families, selected])

  // Data for the selection / download page (built from the selected families).
  const cartFamilies = useMemo<CartFamily[]>(() =>
    families.filter(f => selected.has(f.name)).map(f => ({
      name: f.name,
      styleCount: f.variants.length,
      cssFamily: repVariant(f.variants).cssFamily,
      variants: f.variants.map(v => ({
        url: systemApi.downloadUrl(v.file.id),
        weight: v.meta?.weight ?? 400,
        italic: v.meta?.italic ?? false,
        format: fontFormat(v.file.name),
      })),
    })), [families, selected])

  const itemByKey = (k: string) => items.find(i => i.key === k)
  const selectedFileIds = (keys: string[]) => [...new Set(keys.flatMap(k => itemByKey(k)?.fileIds ?? []))]

  // ── Selection ──────────────────────────────────────────────────────────────
  const onCardClick = (key: string, e: React.MouseEvent) => {
    setFocusKey(key)
    if (e.ctrlKey || e.metaKey) {
      setSelected(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
    } else if (e.shiftKey && focusKey) {
      const ks = items.map(i => i.key)
      const a = ks.indexOf(focusKey), b = ks.indexOf(key)
      if (a >= 0 && b >= 0) setSelected(new Set(ks.slice(Math.min(a, b), Math.max(a, b) + 1)))
    } else {
      setSelected(new Set([key]))
    }
  }
  const toggleCheckbox = (key: string) => setSelected(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })

  // ── Import (button, file input, or drag & drop) ──────────────────────────────
  const onImportClick = () => fileInputRef.current?.click()
  const uploadOne = async (file: File, overwrite: boolean) => {
    setBusy(true)
    try { await systemApi.uploadFile(file, folderId, undefined, overwrite).catch(() => {}); await refresh() }
    finally { setBusy(false) }
  }
  const importFiles = async (files: File[]) => {
    const fonts = files.filter(f => FONT_RE.test(f.name) || f.type.startsWith('font/'))
    if (!fonts.length) return
    // Names already present in this folder → defer to a conflict prompt.
    const existing = new Set(entries.map(e => e.file.name.toLowerCase()))
    const fresh = fonts.filter(f => !existing.has(f.name.toLowerCase()))
    const dupes = fonts.filter(f => existing.has(f.name.toLowerCase()))
    if (fresh.length) {
      setBusy(true)
      try { for (const f of fresh) { try { await systemApi.uploadFile(f, folderId, undefined, false) } catch { /* skip */ } } await refresh() }
      finally { setBusy(false) }
    }
    if (dupes.length) setConflicts(prev => [...prev, ...dupes])
  }
  // Resolve the head of the conflict queue with the user's choice.
  const resolveConflict = async (choice: ConflictChoice) => {
    const [cur, ...rest] = conflicts
    setConflicts(rest)
    if (cur && choice !== 'cancel') await uploadOne(cur, choice === 'overwrite')
  }
  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    void importFiles(files)
  }
  const onDragEnter = (e: React.DragEvent) => { e.preventDefault(); dragCounter.current++; if (e.dataTransfer.types.includes('Files')) setIsDragOver(true) }
  const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setIsDragOver(false) } }
  const onDragOver = (e: React.DragEvent) => { e.preventDefault() }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); dragCounter.current = 0; setIsDragOver(false)
    void importFiles(Array.from(e.dataTransfer.files ?? []))
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  const deleteKeys = async (keys: string[]) => {
    const ids = selectedFileIds(keys)
    if (!ids.length) return
    const labels = keys.map(k => itemByKey(k)?.label).filter(Boolean)
    const ok = await confirm({
      title: 'Supprimer ?',
      message: ids.length === 1
        ? `« ${labels[0]} » sera définitivement supprimée.`
        : `${ids.length} police(s)${keys.length !== ids.length ? '' : ''} seront définitivement supprimées${labels.length === 1 ? ` (famille « ${labels[0]} »)` : ''}.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    })
    if (!ok) return
    setBusy(true)
    try { await Promise.all(ids.map(id => systemApi.deleteFile(id).catch(() => {}))); setSelected(new Set()); await refresh() }
    finally { setBusy(false) }
  }

  // ── Context menu ───────────────────────────────────────────────────────────────
  const openCardMenu = (key: string, pos: MenuDropdownPos) => {
    const keys = selected.has(key) && selected.size > 1 ? [...selected] : [key]
    if (!(selected.has(key) && selected.size > 1)) { setSelected(new Set([key])); setFocusKey(key) }
    setCtx({ pos, keys })
  }
  const buildMenu = (keys: string[]): MenuItem[] => {
    const multi = keys.length > 1
    const it = !multi ? itemByKey(keys[0]) : undefined
    const out: MenuItem[] = []
    if (!multi && it?.family && it.family.variants.length > 1) {
      out.push({ type: 'action', label: 'Ouvrir la famille', icon: <FolderOpen size={15} />, onClick: () => setActiveFamily(it.family!.name) })
      out.push({ type: 'separator' })
    }
    out.push({ type: 'action', label: multi ? `Supprimer (${selectedFileIds(keys).length})` : 'Supprimer', icon: <Trash2 size={15} />, danger: true, onClick: () => deleteKeys(keys) })
    out.push({ type: 'separator' })
    out.push({ type: 'action', label: 'Importer des polices…', icon: <Upload size={15} />, onClick: onImportClick })
    return out
  }

  const selCount = selectedFileIds([...selected]).length

  // Build the specimen-page data for an opened family (from its parsed metadata).
  const specimenData = (fam: Family): FontSpecimenData => {
    const rep = repVariant(fam.variants)
    return {
      name:        fam.name,
      designer:    rep.meta?.manufacturer || rep.meta?.designer || '',
      designerUrl: rep.meta?.designerUrl,
      vendorUrl:   rep.meta?.vendorUrl,
      category:    rep.meta?.category || 'Texte',
      scripts:     [...new Set(fam.variants.flatMap(v => v.meta?.scripts ?? []))],
      version:     rep.meta?.version,
      copyright:   rep.meta?.copyright,
      description: rep.meta?.description,
      license:     rep.meta?.license,
      licenseUrl:  rep.meta?.licenseUrl,
      embeddable:  rep.meta?.embeddable,
      variants:    fam.variants.map(v => ({ id: v.file.id, cssFamily: v.cssFamily, weight: v.meta?.weight ?? 400, italic: v.meta?.italic ?? false })),
    }
  }
  const deleteFamily = async (fam: Family) => {
    const ids = fam.variants.map(v => v.file.id)
    const ok = await confirm({
      title: 'Supprimer ?',
      message: `La famille « ${fam.name} » (${ids.length} fichier${ids.length > 1 ? 's' : ''}) sera définitivement supprimée.`,
      confirmLabel: 'Supprimer', variant: 'danger',
    })
    if (!ok) return
    setBusy(true)
    try { await Promise.all(ids.map(id => systemApi.deleteFile(id).catch(() => {}))); setActiveFamily(null); await refresh() }
    finally { setBusy(false) }
  }
  const downloadFamily = (fam: Family) => {
    fam.variants.forEach(v => {
      const a = document.createElement('a')
      a.href = systemApi.downloadUrl(v.file.id); a.download = ''
      document.body.appendChild(a); a.click(); a.remove()
    })
  }

  // Shared per-item props for the fonts-home views (grid / row / sample).
  const homeItemProps = (it: DisplayItem) => ({
    it,
    selected:    selected.has(it.key),
    preSelected: preSelectedIds.has(it.key),
    selecting:   selected.size > 0,
    onClick:     (e: React.MouseEvent) => onCardClick(it.key, e),
    onToggle:    () => toggleCheckbox(it.key),
    onDouble:    () => { if (it.family) setActiveFamily(it.family.name) },
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); openCardMenu(it.key, { top: e.clientY, left: e.clientX }) },
  })

  return (
    // Stop right-clicks from bubbling to the global drive context-menu provider
    // (this view has its own font-specific menu).
    <div className="relative flex flex-col h-full min-h-0 bg-surface-1"
      onContextMenu={e => { e.preventDefault(); e.stopPropagation() }}
      onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={onDragOver} onDrop={onDrop}>
      <input ref={fileInputRef} type="file" multiple accept={ACCEPT} hidden onChange={onFileInput} />

      {/* Drag & drop import overlay */}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-primary bg-primary/5">
          <Upload size={48} className="text-primary opacity-80" />
          <p className="text-primary font-medium text-sm">Déposez ici pour importer des polices</p>
          <p className="text-primary/60 text-xs">.ttf, .otf, .ttc, .woff…</p>
        </div>
      )}

      {/* Top bar : breadcrumb + actions */}
      <div className="flex items-center gap-2 px-4 sm:px-6 pt-5 pb-2 shrink-0">
        <Tooltip label="Retour">
          <button onClick={() => cartOpen ? setCartOpen(false) : activeFamily ? setActiveFamily(null) : onExit()}
            className="p-1.5 rounded-lg text-text-tertiary hover:bg-surface-2 hover:text-text-primary">
            <ArrowLeft size={18} />
          </button>
        </Tooltip>
        <div className="flex items-center gap-1.5 text-sm text-text-secondary">
          <Type size={15} className="text-violet-600" />
          <button onClick={() => { setCartOpen(false); setActiveFamily(null) }} className="hover:underline">Fonts</button>
          {(activeFamily || cartOpen) && <><span className="text-text-tertiary">/</span><span className="text-text-primary font-medium">{cartOpen ? 'Sélection' : activeFamily}</span></>}
        </div>
        <div className="flex-1" />
        {selCount > 0 && (
          <Button variant="danger" size="sm" icon={<Trash2 size={15} />} onClick={() => deleteKeys([...selected])} disabled={busy}>
            Supprimer ({selCount})
          </Button>
        )}
        <Button variant="secondary" size="sm" icon={<Upload size={15} />} onClick={onImportClick} loading={busy}>
          Importer
        </Button>
        {!activeFamily && !cartOpen && <FontViewToggle mode={viewMode} onMode={setViewMode} />}
      </div>

      {/* Heading — home only (the specimen and selection pages bring their own). */}
      {!activeFamily && !cartOpen && (
        <div className="px-4 sm:px-6 pb-3 shrink-0">
          <h1 className="text-primary text-lg font-medium">Aperçu et gestion des polices</h1>
          <p className="text-text-tertiary text-xs mt-0.5">Affichez un aperçu, importez ou supprimez les polices installées, regroupées par famille.</p>
        </div>
      )}

      {/* Grid */}
      <div ref={containerRef}
        className="flex-1 min-h-0 overflow-auto px-4 sm:px-6 pb-4"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
        onContextMenu={e => { if (e.target === e.currentTarget) { e.preventDefault(); e.stopPropagation(); setCtx({ pos: { top: e.clientY, left: e.clientX }, keys: [] }) } }}
        onClick={e => { if (e.target === e.currentTarget) setSelected(new Set()) }}>
        {loading ? (
          <div className="flex items-center justify-center h-40 text-text-tertiary text-sm gap-2">
            <Spinner size="sm" /> Chargement des polices…
          </div>
        ) : cartOpen ? (
          // Selection / download page (opened from the header bag).
          <FontDownloadPage
            families={cartFamilies}
            onRemove={name => setSelected(prev => { const n = new Set(prev); n.delete(name); return n })}
            onOpen={name => { setCartOpen(false); setActiveFamily(name) }}
            onDownloadFamily={name => { const fam = families.find(f => f.name === name); if (fam) downloadFamily(fam) }}
            onDownloadAll={() => families.filter(f => selected.has(f.name)).forEach(downloadFamily)}
            onClearAll={() => setSelected(new Set())}
          />
        ) : !entries.length ? (
          <div className="flex flex-col items-center justify-center h-40 text-text-tertiary gap-3">
            <Type size={36} className="opacity-30" /><p className="text-sm">Aucune police dans ce dossier.</p>
            <Button variant="secondary" size="sm" icon={<Upload size={15} />} onClick={onImportClick}>Importer des polices</Button>
          </div>
        ) : !current && items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-text-tertiary gap-2">
            <Type size={36} className="opacity-30" />
            <p className="text-xs">Aucune police ne correspond à « {query.trim()} ».</p>
          </div>
        ) : current ? (
          // Family detail view — Google-Fonts-like specimen page.
          <FontSpecimenPage
            data={specimenData(current)}
            onDelete={() => deleteFamily(current)}
            onDownload={() => downloadFamily(current)}
          />
        ) : viewMode === 'row' ? (
          // Fonts home — Row view: full-width rows, one big clipped specimen each.
          <div className="divide-y divide-border">
            {items.map((it, i) => <FontRow key={it.key} {...homeItemProps(it)} sampleText={SAMPLE_TEXT} mergeTop={i > 0 && selected.has(items[i - 1].key)} mergeBottom={i < items.length - 1 && selected.has(items[i + 1].key)} />)}
          </div>
        ) : viewMode === 'sample' ? (
          // Fonts home — Sample view: colourful per-family specimen posters.
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-5">
            {items.map(it => <FontSampleCard key={it.key} {...homeItemProps(it)} />)}
          </div>
        ) : (
          // Fonts home — Grid view: Google-Fonts-like specimen cards, one per family.
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-5">
            {items.map(it => <FontSpecimenCard key={it.key} {...homeItemProps(it)} sampleText={SAMPLE_TEXT} fontSize={SPECIMEN_SIZE} />)}
          </div>
        )}
      </div>

      {/* Marquee selection rectangle */}
      {marqueeStyle && marqueeStyle.width > 2 && marqueeStyle.height > 2 && (
        <div className="pointer-events-none z-50 rounded border border-primary/50 bg-primary/10" style={marqueeStyle as CSSProperties} />
      )}

      {/* Bottom details bar */}
      <FontDetailsBar items={items} totalCount={items.length} selected={selected} />

      {ctx && <MenuDropdown pos={{ ...ctx.pos, minWidth: 200 }} onClose={() => setCtx(null)}
        items={ctx.keys.length ? buildMenu(ctx.keys) : [{ type: 'action', label: 'Importer des polices…', icon: <Upload size={15} />, onClick: onImportClick }]} />}

      {confirmState && <ConfirmDialog {...confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />}
      {conflicts.length > 0 && <ConflictDialog type="file" name={conflicts[0].name} onChoice={resolveConflict} />}
    </div>
  )
}

// ── Fonts-home views (Google-Fonts-like): grid / row / sample ────────────────────

// View-mode toggle placed next to the Import button (Row / Grid / Sample).
function FontViewToggle({ mode, onMode }: { mode: FontViewMode; onMode: (m: FontViewMode) => void }) {
  const opts: { key: FontViewMode; label: string; icon: React.ReactNode }[] = [
    { key: 'row',    label: 'Lignes',      icon: <Rows3 size={16} /> },
    { key: 'grid',   label: 'Grille',      icon: <LayoutGrid size={16} /> },
    { key: 'sample', label: 'Échantillon', icon: <ImageIcon size={16} /> },
  ]
  return (
    <div className="flex items-center gap-1 p-1 rounded-full border border-border bg-white">
      {opts.map(o => (
        <button key={o.key} onClick={() => onMode(o.key)}
          className={clsx('flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium transition-colors',
            mode === o.key ? 'bg-primary-light text-primary' : 'text-text-secondary hover:bg-surface-2')}>
          {o.icon}<span className="hidden md:inline">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

// Selection ring drawn as per-side inset box-shadows so stacked selected rows
// collapse their shared edge to 2px: a row whose previous sibling is also
// selected (`mergeTop`) omits its top edge. Non-adjacent edges stay 2px.
const SEL_RING = 'var(--color-primary, #1a73e8)'
function selRingShadow(mergeTop?: boolean, mergeBottom?: boolean): string {
  const p = [`inset 2px 0 0 0 ${SEL_RING}`, `inset -2px 0 0 0 ${SEL_RING}`]
  if (!mergeTop)    p.push(`inset 0 2px 0 0 ${SEL_RING}`)
  if (!mergeBottom) p.push(`inset 0 -2px 0 0 ${SEL_RING}`)
  return p.join(', ')
}

interface SpecimenProps {
  it: DisplayItem
  selected: boolean; preSelected?: boolean; selecting: boolean; mergeTop?: boolean; mergeBottom?: boolean
  onClick: (e: React.MouseEvent) => void; onToggle: () => void; onDouble?: () => void; onContextMenu: (e: React.MouseEvent) => void
}
// Family metadata used by every home view.
function famMeta(it: DisplayItem) {
  const fam = it.family
  const rep = fam ? repVariant(fam.variants) : it.variant
  return {
    designer:   rep?.meta?.manufacturer || rep?.meta?.designer || '',
    category:   rep?.meta?.category || 'Texte',
    styleCount: fam ? fam.variants.length : 1,
  }
}

// Grid view — specimen card: header (name + designer + styles) over a wrapped
// sample line rendered in the real font, clipped to keep cards uniform.
function FontSpecimenCard({ it, sampleText, fontSize, selected, preSelected, selecting, onClick, onToggle, onDouble, onContextMenu }: SpecimenProps & { sampleText: string; fontSize: number }) {
  const { designer, styleCount } = famMeta(it)
  const [hover, setHover] = useState(false)
  const showBox = selected || selecting || !!preSelected || hover
  return (
    <div data-selectable-id={it.key}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      className={clsx(
        'relative flex flex-col rounded-xl border bg-white px-6 pt-5 pb-6 h-[320px] overflow-hidden select-none cursor-default transition-shadow',
        selected ? 'border-primary ring-2 ring-primary ring-inset'
          : preSelected ? 'border-primary/50 ring-2 ring-primary/20'
          : 'border-[#e0e3e7] hover:shadow-[0_1px_10px_rgba(0,0,0,0.12)]',
      )}
      onClick={onClick} onDoubleClick={onDouble} onContextMenu={onContextMenu}>
      <div className="flex items-start justify-between gap-3 shrink-0">
        <div className={clsx('min-w-0 transition-[padding]', showBox && 'pl-7')}>
          <p className="text-[15px] font-medium text-text-primary truncate leading-tight">{it.label}</p>
          {designer && <p className="text-xs text-text-tertiary truncate mt-0.5">{designer}</p>}
        </div>
        <span className="text-xs text-text-tertiary whitespace-nowrap shrink-0">{styleCount} style{styleCount > 1 ? 's' : ''}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden mt-4">
        <p className="text-[#202124] break-words leading-[1.15]"
          style={{ fontFamily: it.cssFamily ? `'${it.cssFamily}', system-ui` : undefined, fontSize }}>
          {sampleText}
        </p>
      </div>
      <SelectBox show={showBox} selected={selected} preSelected={preSelected} onToggle={onToggle} className="top-4 left-4" />
    </div>
  )
}

// Row view — full-width row: metadata line + one big single-line specimen,
// clipped with a soft right fade (like Google Fonts' list view).
function FontRow({ it, sampleText, selected, preSelected, selecting, mergeTop, mergeBottom, onClick, onToggle, onDouble, onContextMenu }: SpecimenProps & { sampleText: string }) {
  const { designer, styleCount } = famMeta(it)
  const [hover, setHover] = useState(false)
  const showBox = selected || selecting || !!preSelected || hover
  const fade = 'linear-gradient(to right, black 86%, transparent 100%)'
  return (
    <div data-selectable-id={it.key}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      className={clsx('relative py-5 cursor-default select-none', selected && 'bg-primary-light/40')}
      style={selected ? { boxShadow: selRingShadow(mergeTop, mergeBottom) } : undefined}
      onClick={onClick} onDoubleClick={onDouble} onContextMenu={onContextMenu}>
      <div className={clsx('flex items-center gap-2 mb-3 transition-[padding]', showBox && 'pl-8')}>
        <span className="text-[15px] font-medium text-text-primary">{it.label}</span>
        <span className="text-xs text-text-tertiary whitespace-nowrap">{styleCount} style{styleCount > 1 ? 's' : ''}</span>
        {designer && <><span className="text-text-tertiary/40">|</span><span className="text-xs text-text-tertiary truncate">{designer}</span></>}
      </div>
      <p className="text-[#202124] whitespace-nowrap overflow-hidden leading-none"
        style={{ fontFamily: it.cssFamily ? `'${it.cssFamily}', system-ui` : undefined, fontSize: 52, maskImage: fade, WebkitMaskImage: fade }}>
        {sampleText}
      </p>
      <SelectBox show={showBox} selected={selected} preSelected={preSelected} onToggle={onToggle} className="top-4 left-0" />
    </div>
  )
}

// Sample view — white header over a colourful, per-family generated poster.
function FontSampleCard({ it, selected, preSelected, selecting, onClick, onToggle, onDouble, onContextMenu }: SpecimenProps) {
  const { designer, category, styleCount } = famMeta(it)
  const [hover, setHover] = useState(false)
  const showBox = selected || selecting || !!preSelected || hover
  return (
    <div data-selectable-id={it.key}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      className={clsx('relative flex flex-col rounded-xl border bg-white overflow-hidden select-none cursor-default transition-shadow',
        selected ? 'border-primary ring-2 ring-primary ring-inset'
          : preSelected ? 'border-primary/50' : 'border-[#e0e3e7] hover:shadow-[0_1px_10px_rgba(0,0,0,0.12)]')}
      onClick={onClick} onDoubleClick={onDouble} onContextMenu={onContextMenu}>
      <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className={clsx('min-w-0 transition-[padding]', showBox && 'pl-7')}>
          <p className="text-[15px] font-medium text-text-primary truncate leading-tight">{it.label}</p>
          {designer && <p className="text-xs text-text-tertiary truncate mt-0.5">{designer}</p>}
        </div>
        <span className="text-xs text-text-tertiary whitespace-nowrap shrink-0">{styleCount} style{styleCount > 1 ? 's' : ''}</span>
      </div>
      <div className="px-3 pb-3">
        <SamplePoster name={it.label} cssFamily={it.cssFamily} category={category} />
      </div>
      <SelectBox show={showBox} selected={selected} preSelected={preSelected} onToggle={onToggle} className="top-4 left-4" />
    </div>
  )
}

// Hover/selection checkbox shared by the home views. Visibility is driven by a
// React `show` flag (plain opacity utilities) rather than the `group-hover:`
// variant, which is unreliable inside the module's Tailwind cascade layer.
function SelectBox({ show, selected, preSelected, onToggle, className }: {
  show: boolean; selected: boolean; preSelected?: boolean; onToggle: () => void; className?: string
}) {
  return (
    <div onClick={e => { e.stopPropagation(); onToggle() }}
      className={clsx('absolute transition-opacity', className, show ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
      <FloatCheckbox selected={selected || !!preSelected} onToggle={onToggle} />
    </div>
  )
}

// ── Font card ─────────────────────────────────────────────────────────────────

function FontCard({ id, cssFamily, label, stacked, selected, preSelected, selecting, onClick, onToggle, onDouble, onContextMenu }: {
  id: string; cssFamily: string; label: string; stacked?: boolean; selected: boolean; preSelected?: boolean; selecting: boolean
  onClick: (e: React.MouseEvent) => void; onToggle: () => void; onDouble?: () => void; onContextMenu: (e: React.MouseEvent) => void
}) {
  return (
    <div data-selectable-id={id} className="group flex flex-col items-center gap-2 select-none cursor-default"
      onClick={onClick} onDoubleClick={onDouble} onContextMenu={onContextMenu}>
      <div className="relative w-full">
        {/* stacked-paper effect for multi-font families */}
        {stacked && <>
          <div className="absolute -top-1 left-1.5 right-[-6px] h-full rounded-md border border-[#e0e3e7] bg-white" />
          <div className="absolute -top-0.5 left-0.5 right-[-3px] h-full rounded-md border border-[#e0e3e7] bg-white" />
        </>}
        <div className={clsx(
          'relative aspect-square rounded-md border bg-white flex items-center justify-center overflow-hidden transition-shadow',
          selected ? 'border-primary ring-2 ring-primary bg-[#eaf2fe]'
            : preSelected ? 'border-primary/50 bg-[#eaf2fe]'
            : 'border-[#e0e3e7] hover:shadow-[0_1px_6px_rgba(0,0,0,0.1)]',
        )}>
          {/* folded corner */}
          <div className="absolute top-0 right-0 w-4 h-4 bg-[#f1f3f4] border-l border-b border-[#e0e3e7]" style={{ clipPath: 'polygon(100% 0, 0 0, 100% 100%)' }} />
          <span className="text-[#202124] leading-none" style={{ fontFamily: cssFamily ? `'${cssFamily}', system-ui` : undefined, fontSize: 44 }}>Abg</span>
          {/* Selection checkbox — visible on hover or when a selection is active. */}
          <div onClick={e => { e.stopPropagation(); onToggle() }}
            className={clsx('absolute top-1 left-1 transition-opacity', selected || selecting || preSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
            <FloatCheckbox selected={selected || !!preSelected} onToggle={onToggle} />
          </div>
        </div>
      </div>
      <p className="text-xs text-text-primary text-center leading-tight line-clamp-2 px-1">{label}</p>
    </div>
  )
}

// ── Details bar ───────────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className="flex items-baseline gap-1.5 min-w-0">
      <span className="text-text-tertiary whitespace-nowrap">{label} :</span>
      <span className="text-text-primary truncate" title={value}>{value}</span>
    </div>
  )
}

function FontDetailsBar({ items, totalCount, selected }: {
  items: DisplayItem[]; totalCount: number; selected: Set<string>
}) {
  const selCount = [...new Set([...selected].flatMap(k => items.find(i => i.key === k)?.fileIds ?? []))].length
  // Exactly one selected → show its details. Multiple → count. None → total.
  const it = selected.size === 1 ? items.find(i => i.key === [...selected][0]) : undefined

  let title = '', styles = '', scripts = '', designer = '', category = '', embed = '', cssFamily = ''
  if (it) {
    cssFamily = it.cssFamily
    if (it.family) {
      title = it.family.name
      const r = repVariant(it.family.variants)
      styles = it.family.variants.map(v => styleLabelFr(v.meta?.subfamily ?? 'Normal')).join(' ; ')
      scripts = [...new Set(it.family.variants.flatMap(v => v.meta?.scripts ?? []))].join(' ; ')
      designer = r.meta?.manufacturer || r.meta?.designer || ''
      category = r.meta?.category || ''
      embed = r.meta?.embeddable || ''
    } else if (it.variant) {
      const v = it.variant
      title = v.meta?.fullName || v.file.name
      styles = styleLabelFr(v.meta?.subfamily ?? 'Normal')
      scripts = (v.meta?.scripts ?? []).join(' ; ')
      designer = v.meta?.manufacturer || v.meta?.designer || ''
      category = v.meta?.category || ''
      embed = v.meta?.embeddable || ''
    }
  }

  return (
    <div className="shrink-0 border-t border-border bg-surface-2/60 px-4 sm:px-6 py-2 min-h-[52px] flex items-center gap-4">
      {it ? (
        <>
          <div className="shrink-0 w-10 h-10 rounded border border-[#e0e3e7] bg-white flex items-center justify-center overflow-hidden">
            <span className="text-[#202124] leading-none" style={{ fontFamily: cssFamily ? `'${cssFamily}', system-ui` : undefined, fontSize: 18 }}>Abg</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-primary truncate mb-0.5">{title}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-0.5 text-xs">
              <Field label="Style de police" value={styles} />
              <Field label="Conçu pour" value={scripts} />
              <Field label="Concepteur ou studio" value={designer} />
              <Field label="Catégorie" value={category} />
              <Field label="Faculté d'incorporation" value={embed} />
              <Field label="Afficher/Masquer" value="Afficher" />
            </div>
          </div>
        </>
      ) : (
        <span className="text-xs text-text-tertiary">{selCount > 0 ? `${selCount} élément(s) sélectionné(s)` : `${totalCount} élément(s)`}</span>
      )}
    </div>
  )
}
