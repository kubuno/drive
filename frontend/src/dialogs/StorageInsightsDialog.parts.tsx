/**
 * The parts of `StorageInsightsDialog.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import type { StorageInsightsDialog } from './StorageInsightsDialog'

export function Part1({ Icon }: { Icon: NonNullable<StorageInsightsDialog['rows_sorted_categories']>[number]['Icon'] }) {
  return (
    <Icon size={18} className="text-text-secondary shrink-0" />
  )
}

export function Part2({ pct }: { pct: NonNullable<StorageInsightsDialog['rows_sorted_categories']>[number]['pct'] }) {
  return (
    <div
                                className="bg-primary h-2 rounded-full"
                                style={{ width: `${pct}%` }}
                              />
  )
}
