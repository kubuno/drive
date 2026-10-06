// Version-history accounting shared by the three places where histories surface:
// the details panel, the item context menu and the storage page.
//
// Kept revisions are billed against the user's quota, so they must stay both
// visible and reclaimable — a history nobody can see is a history nobody can
// free. The published `@kubuno/drive` surface predates that accounting, so the
// two extra file fields and the two endpoints are declared here rather than
// imported from the package.
import { api } from '@kubuno/sdk'

/**
 * Version statistics carried by a file payload. Only the listing and the file
 * detail compute them; every other endpoint leaves them out, hence optional.
 * `version_count` excludes the current content — it counts the OLD revisions,
 * which is exactly what a purge would reclaim.
 */
export interface FileVersionStats {
  version_count?: number
  version_bytes?: number
}

/**
 * How many revisions a file must keep before its history is surfaced.
 *
 * One, and it cannot be anything else: `version_count` excludes the current
 * file, so a file at 1 already holds one revision that is **charged to the
 * account's quota**. The platform bills what a person can free itself, and
 * nobody can free what they are never shown — a threshold of 2 would charge for
 * a revision and hide it in the same breath.
 *
 * The constant lives here so the details row, the menu entry and the storage
 * list can never disagree about what "has a history" means.
 */
export const MIN_VERSIONS_SHOWN = 1

/** Revisions kept for a file, tolerating payloads that omit the join. */
export function versionCount(file: FileVersionStats | null | undefined): number {
  return file?.version_count ?? 0
}

/** Bytes held by those revisions, tolerating payloads that omit the join. */
export function versionBytes(file: FileVersionStats | null | undefined): number {
  return file?.version_bytes ?? 0
}

/** Whether the file carries a history worth showing and offering to purge. */
export function hasReclaimableHistory(file: FileVersionStats | null | undefined): boolean {
  return versionCount(file) >= MIN_VERSIONS_SHOWN
}

/** What `DELETE /:id/versions` reports once the history is gone. */
export interface VersionsPurgeResult {
  removed:     number
  freed_bytes: number
}

/** Drops a file's whole history; the current content is kept untouched. */
export async function purgeFileVersions(fileId: string): Promise<VersionsPurgeResult> {
  const { data } = await api.delete<VersionsPurgeResult>(`/drive/${fileId}/versions`)
  return data
}

/** What every history of the account weighs, as reported by the backend. */
export interface VersionsSummary {
  files_with_versions: number
  total_versions:      number
  total_bytes:         number
}

export async function fetchVersionsSummary(): Promise<VersionsSummary> {
  const { data } = await api.get<VersionsSummary>('/drive/versions/summary')
  return data
}

/** React Query key for the account-wide summary, shared by readers and invalidators. */
export const VERSIONS_SUMMARY_KEY = ['drive-versions-summary'] as const
