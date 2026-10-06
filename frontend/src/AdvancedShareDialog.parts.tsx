/**
 * The parts of `AdvancedShareDialog.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { Button, Input } from "@ui"
import { Copy, Check } from "lucide-react"
import type { AdvancedShareDialog } from './AdvancedShareDialog'
interface Share {
  id: string
  file_id: string | null
  folder_id: string | null
  token: string | null
  recipient_id: string | null
  can_download: boolean
  can_upload: boolean
  can_delete: boolean
  password_protected: boolean
  expires_at: string | null
  download_count: number
  max_downloads: number | null
  created_at: string
  item_name: string | null
  item_kind: string
  owner_name: string | null
}

function extractToken(url: string): string {
  const parts = url.split('/')
  return parts[parts.length - 1] ?? ''
}

const EMPTY_SHARE: Share = {
  id: '',
  file_id: null,
  folder_id: null,
  token: null,
  recipient_id: null,
  can_download: false,
  can_upload: false,
  can_delete: false,
  password_protected: false,
  expires_at: null,
  download_count: 0,
  max_downloads: null,
  created_at: '',
  item_name: null,
  item_kind: 'file',
  owner_name: null,
}

export function Part1({ canDownload, setCanDownload }: { canDownload: NonNullable<AdvancedShareDialog['canDownload']>; setCanDownload: NonNullable<AdvancedShareDialog['setCanDownload']> }) {
  return (
    <input
                      type="checkbox"
                      checked={canDownload}
                      onChange={e => setCanDownload(e.target.checked)}
                    />
  )
}

export function Part2({ canUpload, setCanUpload }: { canUpload: NonNullable<AdvancedShareDialog['canUpload']>; setCanUpload: NonNullable<AdvancedShareDialog['setCanUpload']> }) {
  return (
    <input
                      type="checkbox"
                      checked={canUpload}
                      onChange={e => setCanUpload(e.target.checked)}
                    />
  )
}

export function Part3({ canDelete, setCanDelete }: { canDelete: NonNullable<AdvancedShareDialog['canDelete']>; setCanDelete: NonNullable<AdvancedShareDialog['setCanDelete']> }) {
  return (
    <input
                      type="checkbox"
                      checked={canDelete}
                      onChange={e => setCanDelete(e.target.checked)}
                    />
  )
}

export function Part4({ pwEnabled, setPwEnabled }: { pwEnabled: NonNullable<AdvancedShareDialog['pwEnabled']>; setPwEnabled: NonNullable<AdvancedShareDialog['setPwEnabled']> }) {
  return (
    <input
                      type="checkbox"
                      checked={pwEnabled}
                      onChange={e => setPwEnabled(e.target.checked)}
                    />
  )
}

export function Part5({ expEnabled, setExpEnabled }: { expEnabled: NonNullable<AdvancedShareDialog['expEnabled']>; setExpEnabled: NonNullable<AdvancedShareDialog['setExpEnabled']> }) {
  return (
    <input
                      type="checkbox"
                      checked={expEnabled}
                      onChange={e => setExpEnabled(e.target.checked)}
                    />
  )
}

export function Part6({ expiresAt, setExpiresAt }: { expiresAt: NonNullable<AdvancedShareDialog['expiresAt']>; setExpiresAt: NonNullable<AdvancedShareDialog['setExpiresAt']> }) {
  return (
    <Input
                      type="datetime-local"
                      value={expiresAt}
                      onChange={e => setExpiresAt(e.target.value)}
                    />
  )
}

export function Part7({ maxEnabled, setMaxEnabled }: { maxEnabled: NonNullable<AdvancedShareDialog['maxEnabled']>; setMaxEnabled: NonNullable<AdvancedShareDialog['setMaxEnabled']> }) {
  return (
    <input
                      type="checkbox"
                      checked={maxEnabled}
                      onChange={e => setMaxEnabled(e.target.checked)}
                    />
  )
}

export function Part8({ maxDownloads, setMaxDownloads }: { maxDownloads: NonNullable<AdvancedShareDialog['maxDownloads']>; setMaxDownloads: NonNullable<AdvancedShareDialog['setMaxDownloads']> }) {
  return (
    <Input
                      type="number"
                      min={1}
                      value={maxDownloads}
                      onChange={e => setMaxDownloads(e.target.value)}
                      placeholder="Nombre maximum"
                    />
  )
}

export function Part9({ createdCopied, handleCopy, createdUrl }: { createdCopied: NonNullable<AdvancedShareDialog['createdCopied']>; handleCopy: NonNullable<AdvancedShareDialog['handleCopy']>; createdUrl: NonNullable<AdvancedShareDialog['createdUrl']> }) {
  return (
    <Button
                        variant="secondary"
                        size="sm"
                        icon={createdCopied ? <Check size={14} /> : <Copy size={14} />}
                        onClick={() => void handleCopy({ ...EMPTY_SHARE, id: 'created', token: extractToken(createdUrl) })}
                      >
                        Copier
                      </Button>
  )
}

export function Part10({ copiedId, share, handleCopy }: { copiedId: AdvancedShareDialog['copiedId']; share: NonNullable<AdvancedShareDialog['rows_my_shares']>[number]['share']; handleCopy: NonNullable<AdvancedShareDialog['handleCopy']> }) {
  return (
    <Button
                          variant="secondary"
                          size="sm"
                          icon={copiedId === share.id ? <Check size={14} /> : <Copy size={14} />}
                          onClick={() => void handleCopy(share)}
                        >
                          Copier
                        </Button>
  )
}
