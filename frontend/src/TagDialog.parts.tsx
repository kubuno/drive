/**
 * The parts of `TagDialog.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { Plus, Pencil, Trash2, Check } from "lucide-react"
import { Button, Input } from "@ui"
import { TAG_COLORS, tagColorHex } from "./driveExtras"
import type { TagDialog } from './TagDialog'
const PALETTE = Object.keys(TAG_COLORS)

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
export { ColorPalette }

export function Part1({ add, newName, busy }: { add: TagDialog['add']; newName: NonNullable<TagDialog['newName']>; busy: NonNullable<TagDialog['busy']> }) {
  return (
    <Button onClick={() => void add()} disabled={!newName.trim()} loading={busy}>
                  <Plus size={15} /> Ajouter
                </Button>
  )
}

export function Part2({ tags, assignedIds, editId, editName, setEditName, editColor, setEditColor, setEditId, saveEdit, busy, target, toggleTag, startEdit, deleteTag }: { tags: NonNullable<TagDialog['tags']>; assignedIds: NonNullable<TagDialog['assignedIds']>; editId: TagDialog['editId']; editName: NonNullable<TagDialog['editName']>; setEditName: NonNullable<TagDialog['setEditName']>; editColor: NonNullable<TagDialog['editColor']>; setEditColor: NonNullable<TagDialog['setEditColor']>; setEditId: NonNullable<TagDialog['setEditId']>; saveEdit: TagDialog['saveEdit']; busy: NonNullable<TagDialog['busy']>; target: TagDialog['props']['target']; toggleTag: NonNullable<TagDialog['toggleTag']>; startEdit: TagDialog['startEdit']; deleteTag: NonNullable<TagDialog['deleteTag']> }) {
  return (
    <>{tags.map((t) => {
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
                    onClick={target ? () => void toggleTag(target, t.id) : undefined}
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
              })}</>
  )
}
