// Tag UI: colored dots painted on cards, and a combined picker/manager dialog
// used both to tag an item and to create/rename/recolor/delete tags.

export interface TagDialogTarget {
  kind: 'file' | 'folder'
  id:   string
  name: string
}
