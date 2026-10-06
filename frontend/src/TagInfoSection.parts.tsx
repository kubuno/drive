/**
 * The parts of `TagInfoSection.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { tagColorHex } from "./driveExtras"
import type { TagInfoSection } from './TagInfoSection'

export function Part1({ t, toggleTag, target, on }: { t: NonNullable<TagInfoSection['rows_tags']>[number]['t']; toggleTag: NonNullable<TagInfoSection['toggleTag']>; target: NonNullable<TagInfoSection['target']>; on: NonNullable<TagInfoSection['rows_tags']>[number]['on'] }) {
  return (
    <button
                    key={t.id}
                    onClick={() => void toggleTag(target, t.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition-colors ${on ? 'border-transparent text-white' : 'border-border text-text-secondary hover:bg-surface-1'}`}
                    style={on ? { backgroundColor: tagColorHex(t.color) } : undefined}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: on ? 'rgba(255,255,255,0.9)' : tagColorHex(t.color) }} />
                    {t.name}
                  </button>
  )
}
