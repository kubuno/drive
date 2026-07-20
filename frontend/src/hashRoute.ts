// Addressable sidebar views that have no route of their own.
//
// Some sidebar entries select a *view* rather than navigating to a page: a saved
// search, a filter, a tab. They still deserve a real link so that the anchor is
// a genuine <a href>, so that the URL can be shared, and so that the browser's
// Back button restores the previous view.
//
// The convention is `/drive/#<kind>/<id>` — the hash keeps the underlying route
// untouched while making the selected view part of the history stack.

/** Base path all hash views hang off (the module's root route). */
const BASE = '/drive'

/** Build a link to an addressable, route-less view: `/drive/#<kind>/<id>`. */
export function hashTo(kind: string, id: string): string {
  return `${BASE}/#${encodeURIComponent(kind)}/${encodeURIComponent(id)}`
}

/**
 * Parse the `hash` part of a location (as given by `useLocation().hash`).
 * Returns null when the hash is absent or does not follow the convention.
 */
export function fromHash(hash: string | undefined | null): { kind: string; id: string } | null {
  if (!hash) return null
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const parts = raw.split('/').filter(Boolean)
  if (parts.length < 2) return null
  try {
    return { kind: decodeURIComponent(parts[0]), id: decodeURIComponent(parts.slice(1).join('/')) }
  } catch {
    return null
  }
}
