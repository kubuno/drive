import React from 'react'
import { Star, Trash2, MoreVertical } from 'lucide-react'
import { FolderGlyph, type Folder } from '@kubuno/drive'
import { usePendingKind, pendingBoxClass, pendingBoxStyle } from '@kubuno/sdk'
import { FloatCheckbox } from '@ui'
import { openable, useLongPress } from '../openable'
import { TagDots } from '../TagUI'

export default function FolderCard({
  folder, isDragTarget, selected, preSelected, focused, trashed, onSelect, onToggle, onOpen, onContextMenu, onDragStart, onDragOver, onDragLeave, onDrop,
}: {
  folder: Folder
  isDragTarget: boolean
  selected: boolean
  preSelected?: boolean
  focused?: boolean
  trashed?: boolean
  onSelect: (id: string, e: React.MouseEvent) => void
  onToggle: (id: string) => void
  onOpen: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
}) {
  const pendingKind = usePendingKind(folder.id)
  const longPress = useLongPress(onContextMenu)
  return (
    <div
      data-selectable-id={folder.id}
      className={`group relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all
                  cursor-default select-none min-w-0
                  ${isDragTarget
                    ? 'border-primary bg-primary/10 ring-2 ring-primary/20'
                    : selected
                    ? 'border-primary ring-2 ring-primary/20 bg-[#c9defa]'
                    : preSelected
                    ? 'border-primary/50 bg-[#c9defa]'
                    : focused
                    ? 'border-primary/60 ring-2 ring-primary/20 bg-[#f3f4f5]'
                    : 'border-[#e8eaed] bg-[#f3f4f5] hover:border-border hover:bg-[#e4ecf7] hover:shadow-sm'
                  } ${pendingBoxClass(pendingKind)}`}
      style={pendingBoxStyle(pendingKind)}
      draggable
      {...openable<React.MouseEvent>({
        select: (e) => { e.preventDefault(); onSelect(folder.id, e) },
        open:   (e) => { e.preventDefault(); e.stopPropagation(); onOpen() },
      })}
      {...longPress}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Checkbox */}
      <FloatCheckbox
        selected={selected}
        onToggle={() => onToggle(folder.id)}
        className="absolute -top-1.5 -left-1.5 z-10"
      />
      <FolderGlyph folder={folder} size={20} className={`shrink-0 ${trashed ? 'opacity-50' : ''}`} />
      <span className={`text-sm truncate flex-1 ${trashed ? 'text-text-secondary line-through' : 'text-text-primary'}`}>{folder.name}</span>
      {!trashed && <TagDots itemId={folder.id} />}
      {folder.is_starred && !trashed && (
        <Star size={12} className="shrink-0 fill-yellow-400 text-yellow-400" />
      )}
      {trashed && (
        <Trash2 size={12} className="shrink-0 text-text-tertiary opacity-60" />
      )}
      <button
        className="shrink-0 p-1 rounded-full hover:bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={e => { e.stopPropagation(); onContextMenu(e) }}
      >
        <MoreVertical size={14} className="text-text-secondary" />
      </button>
    </div>
  )
}
