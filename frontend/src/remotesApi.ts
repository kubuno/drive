/**
 * Update of a remote mount — kept here rather than in `filesApi` because the
 * published `@kubuno/drive` surface does not carry `updateRemote` yet, and the
 * module builds against the published package (dev mode = "published", see
 * CLAUDE.md). Move it to `filesApi` at the next publish of `@kubuno/drive`.
 */
import { api } from '@kubuno/sdk'

export interface UpdateRemoteDto {
  /** Display name. Omit to leave it as is. */
  name?:   string
  /**
   * Whole connection config. Write-only: the server never returns it, so a
   * reconnection re-sends every field rather than patching one of them. Omit to
   * rename only.
   */
  config?: Record<string, unknown>
}

export async function updateRemote(id: string, dto: UpdateRemoteDto): Promise<void> {
  await api.patch(`/drive/remotes/${id}`, dto)
}

export interface RemoteConfigView {
  provider: string
  /** Every non-secret field, as stored — what the edit form prefills. */
  config: Record<string, unknown>
  /** Names of the secrets that are set. Their VALUES never leave the server. */
  secrets_set: string[]
}

/** Throws with `code === 'MOUNT_CONFIG_UNREADABLE'` when nothing can be read. */
export async function getRemoteConfig(id: string): Promise<RemoteConfigView> {
  const { data } = await api.get<RemoteConfigView>(`/drive/remotes/${id}/config`)
  return data
}

/** A share as the server advertises it — its NAME is what a mount needs. */
export interface SmbShare { name: string; comment: string }

/**
 * Lists what an SMB server offers. `mountId` lets the server reuse the password
 * already stored for that mount, since the edit form never holds it.
 */
export async function listSmbShares(input: {
  host: string; username?: string; password?: string; domain?: string; mountId?: string
}): Promise<SmbShare[]> {
  const { data } = await api.post<{ shares: SmbShare[] }>('/drive/smb/shares', {
    host: input.host, username: input.username, password: input.password,
    domain: input.domain, mount_id: input.mountId,
  })
  return data.shares ?? []
}
