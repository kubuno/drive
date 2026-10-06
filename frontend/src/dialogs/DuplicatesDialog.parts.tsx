/**
 * The parts of `DuplicatesDialog.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { formatSize } from "@kubuno/drive"
import { Button } from "@ui"
import { Trash2, FileText, CheckCircle2 } from "lucide-react"
import type { DuplicatesDialog } from './DuplicatesDialog'
function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR')
}

export function Part1() {
  return (
    <CheckCircle2 size={36} strokeWidth={1.5} className="text-primary" />
  )
}

export function Part2({ group, deleting, trashFile }: { group: NonNullable<DuplicatesDialog['rows_groups']>[number]['group']; deleting: NonNullable<DuplicatesDialog['deleting']>; trashFile: NonNullable<DuplicatesDialog['trashFile']> }) {
  return (
    <>{group.files.map((file, idx) => {
                        const isOriginal = idx === 0
                        const isDeleting = deleting[file.id] === true
                        return (
                          <div
                            key={file.id}
                            className="flex items-center gap-3 px-2 py-1.5 rounded-lg bg-surface-1"
                          >
                            <FileText size={16} className="text-text-tertiary flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-text-primary truncate">{file.name}</p>
                              <p className="text-xs text-text-tertiary">
                                {formatSize(file.size_bytes)} · {fmtDate(file.updated_at)}
                              </p>
                            </div>
                            {isOriginal ? (
                              <span className="flex items-center gap-1 text-xs font-medium text-primary bg-surface-2 rounded-full px-2 py-0.5 flex-shrink-0">
                                <CheckCircle2 size={12} />
                                Conservé
                              </span>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                loading={isDeleting}
                                disabled={isDeleting}
                                onClick={() => void trashFile(file)}
                                className="text-danger flex-shrink-0"
                              >
                                <Trash2 size={14} />
                                Mettre à la corbeille
                              </Button>
                            )}
                          </div>
                        )
                      })}</>
  )
}

export function Part3({ trashGroupDuplicates, group, deleting }: { trashGroupDuplicates: NonNullable<DuplicatesDialog['trashGroupDuplicates']>; group: NonNullable<DuplicatesDialog['rows_groups']>[number]['group']; deleting: NonNullable<DuplicatesDialog['deleting']> }) {
  return (
    <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void trashGroupDuplicates(group)}
                          disabled={group.files.slice(1).every(f => deleting[f.id] === true)}
                        >
                          <Trash2 size={14} />
                          Supprimer les doublons
                        </Button>
  )
}
