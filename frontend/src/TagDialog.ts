/**
 * Code-behind of `TagDialog.kbview` (converted from `TagDialog.tsx` by @kubuno/views-migrate).
 */
import { bind, type EventArgs, type MouseEventArgs } from '@kubuno/views'
import { useDriveExtras, type Tag } from "./driveExtras"
import { type TagDialogTarget } from "./TagUI"

import { ViewBase } from './TagDialog.kbview'
import * as __parts from './TagDialog.parts'

export type TagDialogProps = { target: TagDialogTarget | null; onClose: () => void }

export class TagDialog extends ViewBase {
  @bind accessor newName = ''
  @bind accessor newColor = 'blue'
  @bind accessor busy = false
  @bind accessor error = ''
  @bind accessor editId: string | null = null
  @bind accessor editName = ''
  @bind accessor editColor = 'blue'
  tags!: Tag[]
  assignments!: Record<string, string[]>
  createTag!: (name: string, color: string) => Promise<void>
  updateTag!: (id: string, patch: { name?: string; color?: string; }) => Promise<void>
  deleteTag!: (id: string) => Promise<void>
  toggleTag!: TagDialogStores['toggleTag']

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const tags        = useDriveExtras((s) => s.tags)
    const assignments = useDriveExtras((s) => s.assignments)
    const createTag   = useDriveExtras((s) => s.createTag)
    const updateTag   = useDriveExtras((s) => s.updateTag)
    const deleteTag   = useDriveExtras((s) => s.deleteTag)
    const toggleTag   = useDriveExtras((s) => s.toggleTag)
    return { tags, assignments, createTag, updateTag, deleteTag, toggleTag }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ tags: s.tags, assignments: s.assignments, createTag: s.createTag, updateTag: s.updateTag, deleteTag: s.deleteTag, toggleTag: s.toggleTag })
  }

  get assignedIds(): string[] {
    return this.memo('assignedIds', [this.props, this.assignments], () => this.props.target ? (this.assignments[this.props.target.id] ?? []) : [])
  }

  get show_target() {
    return this.memo('show_target', [this.props], () => !!(this.props.target))
  }

  get span_text() {
    if (!(this.props.target)) return undefined as never
    return this.props.target.name
  }

  /** `<ColorPalette>`, rendered by a ReactHost. */
  get ColorPalette() {
    return __parts.ColorPalette
  }

  get color_palette_props() {
    return this.memo('color_palette_props', [this.newColor, this.memo], () => ({ value: this.newColor, onChange: this.memo("setNewColor:bound", [], () => this.setNewColor.bind(this)) }))
  }

  get part1_props() {
    return this.memo('part1_props', [this.memo, this.newName, this.busy, this.error, this.createTag, this.newColor], () => ({ add: this.memo("add:bound", [], () => this.add.bind(this)), newName: this.newName, busy: this.busy }))
  }

  /** A part of the screen still written in React (<Button> with element children). */
  get Part1() {
    return __parts.Part1
  }

  get show_error() {
    return !!(this.error)
  }

  get show_tags() {
    return this.tags.length === 0
  }

  get part2_props() {
    return this.memo('part2_props', [this.tags, this.assignedIds, this.editId, this.editName, this.memo, this.editColor, this.busy, this.updateTag, this.props, this.toggleTag, this.deleteTag], () => ({ tags: this.tags, assignedIds: this.assignedIds, editId: this.editId, editName: this.editName, setEditName: this.memo("setEditName:bound", [], () => this.setEditName.bind(this)), editColor: this.editColor, setEditColor: this.memo("setEditColor:bound", [], () => this.setEditColor.bind(this)), setEditId: this.memo("setEditId:bound", [], () => this.setEditId.bind(this)), saveEdit: this.memo("saveEdit:bound", [], () => this.saveEdit.bind(this)), busy: this.busy, target: this.props.target, toggleTag: this.toggleTag, startEdit: this.memo("startEdit:bound", [], () => this.startEdit.bind(this)), deleteTag: this.deleteTag }))
  }

  /** A part of the screen still written in React (a list whose item is not a single element). */
  get Part2() {
    return __parts.Part2
  }

  async add() {
    const name = this.newName.trim()
    if (!name) return
    this.busy = true; this.error = ''
    try {
      await this.createTag(name, this.newColor)
      this.newName = ''; this.newColor = 'blue'
    } catch (e) {
      this.error = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Échec de la création'
    } finally { this.busy = false }
  }

  startEdit(t: Tag) { this.editId = t.id; this.editName = t.name; this.editColor = t.color }

  async saveEdit() {
    if (!this.editId) return
    const name = this.editName.trim()
    if (!name) return
    this.busy = true
    try { await this.updateTag(this.editId, { name, color: this.editColor }); this.editId = null }
    finally { this.busy = false }
  }

  panel_click(_sender: unknown, _args: MouseEventArgs) {
    this.props.onClose?.()
  }

  panel_click2(_sender: unknown, _args: MouseEventArgs) {
    this.props.onClose?.()
  }

  text_field_key_down(_sender: unknown, args: EventArgs) {
    const e = args.native as React.KeyboardEvent<HTMLInputElement>
 if (e.key === 'Enter') void this.add() }

  button_click(_sender: unknown, _args: MouseEventArgs) {
    this.props.onClose?.()
  }

  /** `setNewColor` of the TSX: a value, or an update of the previous one. */
  setNewColor(value: TagDialog['newColor'] | ((prev: TagDialog['newColor']) => TagDialog['newColor'])) {
    this.newColor = typeof value === 'function' ? (value as (prev: TagDialog['newColor']) => TagDialog['newColor'])(this.newColor) : value
  }

  /** `setEditName` of the TSX: a value, or an update of the previous one. */
  setEditName(value: TagDialog['editName'] | ((prev: TagDialog['editName']) => TagDialog['editName'])) {
    this.editName = typeof value === 'function' ? (value as (prev: TagDialog['editName']) => TagDialog['editName'])(this.editName) : value
  }

  /** `setEditColor` of the TSX: a value, or an update of the previous one. */
  setEditColor(value: TagDialog['editColor'] | ((prev: TagDialog['editColor']) => TagDialog['editColor'])) {
    this.editColor = typeof value === 'function' ? (value as (prev: TagDialog['editColor']) => TagDialog['editColor'])(this.editColor) : value
  }

  /** `setEditId` of the TSX: a value, or an update of the previous one. */
  setEditId(value: string | null | ((prev: string | null) => string | null)) {
    this.editId = typeof value === 'function' ? (value as (prev: string | null) => string | null)(this.editId) : value
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type TagDialogStores = ReturnType<TagDialog['useStores']>

export default TagDialog.component()
