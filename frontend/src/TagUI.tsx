// Tag UI: colored dots painted on cards, and a combined picker/manager dialog
// used both to tag an item and to create/rename/recolor/delete tags.
import { useMemo, useState, useContext } from 'react'
import { Tag as TagIcon, Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import { Button, Input } from '@ui'
import { FileInfoExtraContext } from '@kubuno/drive'
import { useDriveExtras, TAG_COLORS, tagColorHex, type Tag } from './driveExtras'

const PALETTE = Object.keys(TAG_COLORS)

/** Small colored dots shown on file/folder cards for their assigned tags. */
export function TagDots({ itemId, max = 4, size = 8 }: { itemId: string; max?: number; size?: number }) {
  const assignments = useDriveExtras((s) => s.assignments)
  const tags = useDriveExtras((s) => s.tags)
  const ids = assignments[itemId]
  const itemTags = useMemo(() => {
    if (!ids?.length) return []
    const byId = new Map(tags.map((t) => [t.id, t]))
    return ids.map((id) => byId.get(id)).filter((t): t is Tag => !!t)
  }, [ids, tags])
  if (!itemTags.length) return null
  return (
    <span className="flex items-center gap-0.5 shrink-0" title={itemTags.map((t) => t.name).join(', ')}>
      {itemTags.slice(0, max).map((t) => (
        <span
          key={t.id}
          className="rounded-full ring-1 ring-black/5"
          style={{ width: size, height: size, backgroundColor: tagColorHex(t.color) }}
        />
      ))}
    </span>
  )
}

function ColorPalette({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`w-5 h-5 rounded-full transition-transform ${value === c ? 'ring-2 ring-offset-1 ring-text-secondary scale-110' : 'hover:scale-110'}`}
          style={{ backgroundColor: tagColorHex(c) }}
          title={c}
        />
      ))}
    </div>
  )
}

export interface TagDialogTarget {
  kind: 'file' | 'folder'
  id:   string
  name: string
}

/** Combined tag picker (when `target` is set) and manager. */
export function TagDialog({ target, onClose }: { target: TagDialogTarget | null; onClose: () => void }) {
  const tags        = useDriveExtras((s) => s.tags)
  const assignments = useDriveExtras((s) => s.assignments)
  const createTag   = useDriveExtras((s) => s.createTag)
  const updateTag   = useDriveExtras((s) => s.updateTag)
  const deleteTag   = useDriveExtras((s) => s.deleteTag)
  const toggleTag   = useDriveExtras((s) => s.toggleTag)

  const assignedIds = target ? (assignments[target.id] ?? []) : []

  const [newName, setNewName]   = useState('')
  const [newColor, setNewColor] = useState('blue')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')

  const [editId, setEditId]       = useState<string | null>(null)
  const [editName, setEditName]   = useState('')
  const [editColor, setEditColor] = useState('blue')

  const add = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true); setError('')
    try {
      await createTag(name, newColor)
      setNewName(''); setNewColor('blue')
    } catch (e) {
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Échec de la création')
    } finally { setBusy(false) }
  }

  const startEdit = (t: Tag) => { setEditId(t.id); setEditName(t.name); setEditColor(t.color) }
  const saveEdit = async () => {
    if (!editId) return
    const name = editName.trim()
    if (!name) return
    setBusy(true)
    try { await updateTag(editId, { name, color: editColor }); setEditId(null) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 max-h-[85vh] overflow-auto">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <TagIcon size={20} className="text-primary" />
            <h2 className="text-lg font-semibold text-text-primary">Étiquettes</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-2 text-text-secondary"><X size={18} /></button>
        </div>
        {target && (
          <p className="text-sm text-text-secondary mb-4 truncate">
            Étiqueter : <span className="font-medium text-text-primary">{target.name}</span>
          </p>
        )}

        {/* Create row */}
        <div className="border border-border rounded-lg p-3 mb-4 space-y-2 bg-surface-1">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nouvelle étiquette…"
            onKeyDown={(e) => { if (e.key === 'Enter') void add() }}
          />
          <div className="flex items-center justify-between gap-2">
            <ColorPalette value={newColor} onChange={setNewColor} />
            <Button onClick={() => void add()} disabled={!newName.trim()} loading={busy}>
              <Plus size={15} /> Ajouter
            </Button>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>

        {/* Tag list */}
        <div className="space-y-1">
          {tags.length === 0 && (
            <p className="text-sm text-text-tertiary text-center py-4">Aucune étiquette pour l'instant.</p>
          )}
          {tags.map((t) => {
            const assigned = assignedIds.includes(t.id)
            if (editId === t.id) {
              return (
                <div key={t.id} className="border border-primary/40 rounded-lg p-2 space-y-2">
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
                  <div className="flex items-center justify-between gap-2">
                    <ColorPalette value={editColor} onChange={setEditColor} />
                    <div className="flex gap-1">
                      <Button variant="secondary" onClick={() => setEditId(null)}>Annuler</Button>
                      <Button onClick={() => void saveEdit()} loading={busy}>Enregistrer</Button>
                    </div>
                  </div>
                </div>
              )
            }
            return (
              <div
                key={t.id}
                className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 ${target ? 'cursor-pointer hover:bg-surface-1' : ''}`}
                onClick={target ? () => void toggleTag(target.kind, target.id, t.id) : undefined}
              >
                {target && (
                  <span className={`w-4 h-4 rounded border flex items-center justify-center ${assigned ? 'bg-primary border-primary text-white' : 'border-border'}`}>
                    {assigned && <Check size={12} />}
                  </span>
                )}
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tagColorHex(t.color) }} />
                <span className="flex-1 text-sm text-text-primary truncate">{t.name}</span>
                <span className="text-xs text-text-tertiary">{t.item_count}</span>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={(e) => { e.stopPropagation(); startEdit(t) }} className="p-1 rounded hover:bg-surface-2 text-text-secondary"><Pencil size={13} /></button>
                  <button onClick={(e) => { e.stopPropagation(); void deleteTag(t.id) }} className="p-1 rounded hover:bg-danger-light text-danger"><Trash2 size={13} /></button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex justify-end pt-4">
          <Button variant="secondary" onClick={onClose}>Fermer</Button>
        </div>
      </div>
    </div>
  )
}

/** Section « Étiquettes » injectée dans la fenêtre de propriétés (FileInfoModal)
 *  via le slot 'files-info-extra'. Lit la cible dans le contexte du core, gère
 *  l'assignation des étiquettes via le store du module (chips cliquables). */
export function TagInfoSection() {
  const target      = useContext(FileInfoExtraContext)
  const tags        = useDriveExtras((s) => s.tags)
  const assignments = useDriveExtras((s) => s.assignments)
  const toggleTag   = useDriveExtras((s) => s.toggleTag)
  if (!target) return null
  const assignedIds = assignments[target.id] ?? []
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">Étiquettes</p>
      {tags.length === 0 ? (
        <p className="text-sm text-text-tertiary italic">Aucune étiquette — créez-en via « Étiquettes… » dans le menu contextuel.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => {
            const on = assignedIds.includes(t.id)
            return (
              <button
                key={t.id}
                onClick={() => void toggleTag(target.kind, target.id, t.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${on ? 'border-transparent text-white' : 'border-border text-text-secondary hover:bg-surface-1'}`}
                style={on ? { backgroundColor: tagColorHex(t.color) } : undefined}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: on ? 'rgba(255,255,255,0.9)' : tagColorHex(t.color) }} />
                {t.name}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
