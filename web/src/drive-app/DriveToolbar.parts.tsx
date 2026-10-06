/**
 * The parts of `DriveToolbar.kbcontrol` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { CheckSquare, ListChecks } from "lucide-react"
import { Button } from "@ui"
import type { DriveToolbar } from './DriveToolbar'

export function Part1({ allItemsSelected, onToggleSelectAll, t }: { allItemsSelected: NonNullable<DriveToolbar['props']['allItemsSelected']>; onToggleSelectAll: NonNullable<DriveToolbar['props']['onToggleSelectAll']>; t: NonNullable<DriveToolbar['tr']> }) {
  return (
    <Button
                  variant={allItemsSelected ? 'secondary' : 'primary'}
                  size="sm"
                  icon={allItemsSelected ? <CheckSquare size={14} /> : <ListChecks size={14} />}
                  onClick={onToggleSelectAll}
                >
                  {allItemsSelected ? t('app.deselect_all') : t('app.select_all')}
                </Button>
  )
}
