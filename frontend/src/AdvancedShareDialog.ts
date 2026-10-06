/**
 * Code-behind of `AdvancedShareDialog.kbview` (converted from `AdvancedShareDialog.tsx` by @kubuno/views-migrate).
 */
import { bind, type MouseEventArgs } from '@kubuno/views'
import { useState, useEffect, useCallback } from "react"
import { api } from "@kubuno/sdk"

import { ViewBase } from './AdvancedShareDialog.kbview'
import * as __parts from './AdvancedShareDialog.parts'

interface ShareTarget {
  kind: 'file' | 'folder'
  id: string
  name: string
}

interface Props {
  target: ShareTarget | null
  onClose: () => void
}

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

type Tab = 'new' | 'mine' | 'received'

function shareUrl(token: string): string {
  return `${window.location.origin}/api/v1/drive/share/${token}`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export type { Props }

export class AdvancedShareDialog extends ViewBase {
  @bind accessor canDownload = true
  @bind accessor canUpload = false
  @bind accessor canDelete = false
  @bind accessor pwEnabled = false
  @bind accessor password = ''
  @bind accessor expEnabled = false
  @bind accessor expiresAt = ''
  @bind accessor maxEnabled = false
  @bind accessor maxDownloads = ''
  @bind accessor creating = false
  @bind accessor createError: string | null = null
  @bind accessor createdUrl: string | null = null
  @bind accessor createdCopied = false
  @bind accessor myShares: Share[] = []
  @bind accessor receivedShares: Share[] = []
  @bind accessor loadingMine = false
  @bind accessor loadingReceived = false
  @bind accessor copiedId: string | null = null
  tab!: Tab
  setTab!: AdvancedShareDialogHooks['setTab']
  handleCreate!: () => Promise<void>
  handleCopy!: (share: Share) => Promise<void>
  handleRevoke!: (id: string) => Promise<void>

  /** The screen's hooks that read its members (run after the fields of `useStores()` are set). React's rules apply: `use()` runs them on every render. */
  useHooks() {
    const [tab, setTab] = useState<Tab>(this.props.target ? 'new' : 'mine')
    this.publish({ tab, setTab })
    const loadMine = useCallback(async () => {
      this.loadingMine = true
      try {
        const { data } = await api.get<{ shares: Share[] }>('/drive/shares')
        this.myShares = data.shares.filter(s => s.token !== null)
      } catch {
        // Best-effort: keep whatever we had.
      } finally {
        this.loadingMine = false
      }
    }, [])
    const loadReceived = useCallback(async () => {
      this.loadingReceived = true
      try {
        const { data } = await api.get<{ shares: Share[] }>('/drive/shares/received')
        this.receivedShares = data.shares
      } catch {
        // Best-effort.
      } finally {
        this.loadingReceived = false
      }
    }, [])
    useEffect(() => {
      void loadMine()
      void loadReceived()
    }, [loadMine, loadReceived])
    const target = this.props.target
    const handleCreate = useCallback(async () => {
      if (!target) return
      this.creating = true
      this.createError = null
      this.createdUrl = null
      this.createdCopied = false
      try {
        const body: Record<string, unknown> = {
          [target.kind === 'folder' ? 'folder_id' : 'file_id']: target.id,
          can_download: this.canDownload,
          can_upload: this.canUpload,
          can_delete: this.canDelete,
        }
        if (this.pwEnabled && this.password) body.password = this.password
        if (this.expEnabled && this.expiresAt) body.expires_at = new Date(this.expiresAt).toISOString()
        if (this.maxEnabled && this.maxDownloads) body.max_downloads = Number(this.maxDownloads)
    
        const { data } = await api.post<{ share: { token: string | null } }>(
          '/drive/shares',
          body,
        )
    
        if (data.share.token) {
          const url = shareUrl(data.share.token)
          this.createdUrl = url
          try {
            await navigator.clipboard.writeText(url)
            this.createdCopied = true
          } catch {
            // Clipboard may be unavailable; the link is still shown.
          }
        }
        void loadMine()
      } catch (err) {
        // An instance policy (public links off, password required…) answers with
        // a sentence that names the reason. Showing "réessayer" instead would send
        // the user round a loop that cannot succeed.
        const body = (err as { response?: { data?: { error?: string; message?: string } } })
          .response?.data
        this.createError = body?.error === 'POLICY_DISABLED' && body.message
            ? body.message
            : 'La création du lien a échoué. Veuillez réessayer.'
      } finally {
        this.creating = false
      }
    }, [
      target,
      this.canDownload,
      this.canUpload,
      this.canDelete,
      this.pwEnabled,
      this.password,
      this.expEnabled,
      this.expiresAt,
      this.maxEnabled,
      this.maxDownloads,
      loadMine,
    ])
    this.publish({ handleCreate })
    const handleCopy = useCallback(async (share: Share) => {
      if (!share.token) return
      try {
        await navigator.clipboard.writeText(shareUrl(share.token))
        this.copiedId = share.id
        window.setTimeout(() => {
          this.copiedId = (this.copiedId === share.id ? null : this.copiedId)
        }, 1500)
      } catch {
        // Ignore clipboard failures.
      }
    }, [])
    this.publish({ handleCopy })
    const handleRevoke = useCallback(async (id: string) => {
      try {
        await api.delete(`/drive/shares/${id}`)
        this.myShares = this.myShares.filter(s => s.id !== id)
      } catch {
        // Best-effort: leave the list untouched on failure.
      }
    }, [])
    this.publish({ handleRevoke })
    return { tab, setTab, loadMine, loadReceived, handleCreate, handleCopy, handleRevoke }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const h = this.useHooks()
    this.publish({ tab: h.tab, setTab: h.setTab, handleCreate: h.handleCreate, handleCopy: h.handleCopy, handleRevoke: h.handleRevoke })
  }

  get show_target() {
    return this.memo('show_target', [this.props], () => !!(this.props.target))
  }

  get button_class() {
    if (!(this.props.target)) return undefined as never
    return `px-3 py-2 text-sm font-medium -mb-px transition-colors ${
                this.tab === 'new'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`
  }

  get button_class2() {
    return `px-3 py-2 text-sm font-medium -mb-px transition-colors ${
              this.tab === 'mine'
                ? 'text-primary border-b-2 border-primary'
                : 'text-text-secondary hover:text-text-primary'
            }`
  }

  get button_class3() {
    return `px-3 py-2 text-sm font-medium -mb-px transition-colors ${
              this.tab === 'received'
                ? 'text-primary border-b-2 border-primary'
                : 'text-text-secondary hover:text-text-primary'
            }`
  }

  get show_tab_new_target() {
    return this.memo('show_tab_new_target', [this.tab, this.props], () => !!(this.tab === 'new' && this.props.target))
  }

  get span_text() {
    if (!(this.tab === 'new' && this.props.target)) return undefined as never
    return this.props.target.name
  }

  get part1_props() {
    return this.memo('part1_props', [this.canDownload, this.memo, this.tab, this.props], () => {
      if (!(this.tab === 'new' && this.props.target)) return undefined as never
      return ({ canDownload: this.canDownload, setCanDownload: this.memo("setCanDownload:bound", [], () => this.setCanDownload.bind(this)) })
    })
  }

  /** A part of the screen still written in React (<input> has no .kbview element yet). */
  get Part1() {
    if (!(this.tab === 'new' && this.props.target)) return undefined as never
    return __parts.Part1
  }

  get part2_props() {
    return this.memo('part2_props', [this.canUpload, this.memo, this.tab, this.props], () => {
      if (!(this.tab === 'new' && this.props.target)) return undefined as never
      return ({ canUpload: this.canUpload, setCanUpload: this.memo("setCanUpload:bound", [], () => this.setCanUpload.bind(this)) })
    })
  }

  /** A part of the screen still written in React (<input> has no .kbview element yet). */
  get Part2() {
    if (!(this.tab === 'new' && this.props.target)) return undefined as never
    return __parts.Part2
  }

  get part3_props() {
    return this.memo('part3_props', [this.canDelete, this.memo, this.tab, this.props], () => {
      if (!(this.tab === 'new' && this.props.target)) return undefined as never
      return ({ canDelete: this.canDelete, setCanDelete: this.memo("setCanDelete:bound", [], () => this.setCanDelete.bind(this)) })
    })
  }

  /** A part of the screen still written in React (<input> has no .kbview element yet). */
  get Part3() {
    if (!(this.tab === 'new' && this.props.target)) return undefined as never
    return __parts.Part3
  }

  get part4_props() {
    return this.memo('part4_props', [this.pwEnabled, this.memo, this.tab, this.props], () => {
      if (!(this.tab === 'new' && this.props.target)) return undefined as never
      return ({ pwEnabled: this.pwEnabled, setPwEnabled: this.memo("setPwEnabled:bound", [], () => this.setPwEnabled.bind(this)) })
    })
  }

  /** A part of the screen still written in React (<input> has no .kbview element yet). */
  get Part4() {
    if (!(this.tab === 'new' && this.props.target)) return undefined as never
    return __parts.Part4
  }

  get part5_props() {
    return this.memo('part5_props', [this.expEnabled, this.memo, this.tab, this.props], () => {
      if (!(this.tab === 'new' && this.props.target)) return undefined as never
      return ({ expEnabled: this.expEnabled, setExpEnabled: this.memo("setExpEnabled:bound", [], () => this.setExpEnabled.bind(this)) })
    })
  }

  /** A part of the screen still written in React (<input> has no .kbview element yet). */
  get Part5() {
    if (!(this.tab === 'new' && this.props.target)) return undefined as never
    return __parts.Part5
  }

  get part6_props() {
    return this.memo('part6_props', [this.expiresAt, this.memo, this.tab, this.props, this.expEnabled], () => {
      if (!(this.tab === 'new' && this.props.target) || !(this.expEnabled)) return undefined as never
      return ({ expiresAt: this.expiresAt, setExpiresAt: this.memo("setExpiresAt:bound", [], () => this.setExpiresAt.bind(this)) })
    })
  }

  /** A part of the screen still written in React (<TextField type="datetime-local">: no .kbview value). */
  get Part6() {
    if (!(this.tab === 'new' && this.props.target) || !(this.expEnabled)) return undefined as never
    return __parts.Part6
  }

  get part7_props() {
    return this.memo('part7_props', [this.maxEnabled, this.memo, this.tab, this.props], () => {
      if (!(this.tab === 'new' && this.props.target)) return undefined as never
      return ({ maxEnabled: this.maxEnabled, setMaxEnabled: this.memo("setMaxEnabled:bound", [], () => this.setMaxEnabled.bind(this)) })
    })
  }

  /** A part of the screen still written in React (<input> has no .kbview element yet). */
  get Part7() {
    if (!(this.tab === 'new' && this.props.target)) return undefined as never
    return __parts.Part7
  }

  get part8_props() {
    return this.memo('part8_props', [this.maxDownloads, this.memo, this.tab, this.props, this.maxEnabled], () => {
      if (!(this.tab === 'new' && this.props.target) || !(this.maxEnabled)) return undefined as never
      return ({ maxDownloads: this.maxDownloads, setMaxDownloads: this.memo("setMaxDownloads:bound", [], () => this.setMaxDownloads.bind(this)) })
    })
  }

  /** A part of the screen still written in React (<TextField> min: no .kbview property). */
  get Part8() {
    if (!(this.tab === 'new' && this.props.target) || !(this.maxEnabled)) return undefined as never
    return __parts.Part8
  }

  get show_create_error() {
    if (!(this.tab === 'new' && this.props.target)) return undefined as never
    return !!(this.createError)
  }

  get show_created_url() {
    if (!(this.tab === 'new' && this.props.target)) return undefined as never
    return !!(this.createdUrl)
  }

  get span_text2() {
    if (!(this.tab === 'new' && this.props.target) || !(this.createdUrl)) return undefined as never
    return this.createdCopied ? 'Lien copié dans le presse-papier' : 'Lien créé'
  }

  get part9_props() {
    return this.memo('part9_props', [this.createdCopied, this.handleCopy, this.createdUrl, this.tab, this.props], () => {
      if (!(this.tab === 'new' && this.props.target) || !(this.createdUrl)) return undefined as never
      return ({ createdCopied: this.createdCopied, handleCopy: this.handleCopy, createdUrl: this.createdUrl })
    })
  }

  /** A part of the screen still written in React (<Button Icon>: an icon that is not a Lucide icon). */
  get Part9() {
    if (!(this.tab === 'new' && this.props.target) || !(this.createdUrl)) return undefined as never
    return __parts.Part9
  }

  get show_tab_mine() {
    return this.tab === 'mine'
  }

  get show_loading_mine_my_shares() {
    if (!(this.tab === 'mine')) return undefined as never
    return this.loadingMine && this.myShares.length === 0
  }

  get show_not_loading_mine_my_shares() {
    if (!(this.tab === 'mine')) return undefined as never
    return !(this.loadingMine && this.myShares.length === 0)
  }

  get show_my_shares() {
    if (!(this.tab === 'mine') || !(!(this.loadingMine && this.myShares.length === 0))) return undefined as never
    return this.myShares.length === 0
  }

  get show_not_my_shares() {
    if (!(this.tab === 'mine') || !(!(this.loadingMine && this.myShares.length === 0))) return undefined as never
    return !(this.myShares.length === 0)
  }

  /** A part of the screen still written in React (<Button Icon>: an icon that is not a Lucide icon). */
  get Part10() {
    if (!(this.tab === 'mine') || !(!(this.loadingMine && this.myShares.length === 0)) || !(!(this.myShares.length === 0))) return undefined as never
    return __parts.Part10
  }

  /** The rows of the Repeater over `myShares`. */
  get rows_my_shares() {
    return this.memo('rows_my_shares', [this.myShares, this.tab, this.loadingMine, this.copiedId, this.handleCopy], () => {
      if (!(this.tab === 'mine') || !(!(this.loadingMine && this.myShares.length === 0)) || !(!(this.myShares.length === 0))) return undefined as never
      return this.myShares.map((share) => {
      return { share, span_text: ((this.tab === 'mine') && (!(this.loadingMine && this.myShares.length === 0)) && (!(this.myShares.length === 0))) ? (share.item_name ?? 'Élément') : undefined, show_share_expires_at: ((this.tab === 'mine') && (!(this.loadingMine && this.myShares.length === 0)) && (!(this.myShares.length === 0))) ? (!!(share.expires_at)) : undefined, text: ((this.tab === 'mine') && (!(this.loadingMine && this.myShares.length === 0)) && (!(this.myShares.length === 0)) && (share.expires_at)) ? (" " + String(formatDate(share.expires_at))) : undefined, text2: ((this.tab === 'mine') && (!(this.loadingMine && this.myShares.length === 0)) && (!(this.myShares.length === 0))) ? (" " + String(share.download_count) + "/" + String(share.max_downloads ?? '∞')) : undefined, part10_props: ((this.tab === 'mine') && (!(this.loadingMine && this.myShares.length === 0)) && (!(this.myShares.length === 0))) ? ({ copiedId: this.copiedId, share: share, handleCopy: this.handleCopy }) : undefined, key: share.id }
    })
    })
  }

  get visible() {
    return this.memo('visible', [this.show_my_shares, this.show_not_loading_mine_my_shares, this.tab], () => {
      if (!(this.tab === 'mine')) return undefined as never
      return this.show_my_shares && this.show_not_loading_mine_my_shares
    })
  }

  get visible2() {
    return this.memo('visible2', [this.show_not_my_shares, this.show_not_loading_mine_my_shares, this.tab], () => {
      if (!(this.tab === 'mine')) return undefined as never
      return this.show_not_my_shares && this.show_not_loading_mine_my_shares
    })
  }

  get show_tab_received() {
    return this.tab === 'received'
  }

  get show_loading_received_received_shares() {
    if (!(this.tab === 'received')) return undefined as never
    return this.loadingReceived && this.receivedShares.length === 0
  }

  get show_not_loading_received_received_shares() {
    if (!(this.tab === 'received')) return undefined as never
    return !(this.loadingReceived && this.receivedShares.length === 0)
  }

  get show_received_shares() {
    if (!(this.tab === 'received') || !(!(this.loadingReceived && this.receivedShares.length === 0))) return undefined as never
    return this.receivedShares.length === 0
  }

  get show_not_received_shares() {
    if (!(this.tab === 'received') || !(!(this.loadingReceived && this.receivedShares.length === 0))) return undefined as never
    return !(this.receivedShares.length === 0)
  }

  /** The rows of the Repeater over `receivedShares`. */
  get rows_received_shares() {
    return this.memo('rows_received_shares', [this.receivedShares, this.tab, this.loadingReceived], () => {
      if (!(this.tab === 'received') || !(!(this.loadingReceived && this.receivedShares.length === 0)) || !(!(this.receivedShares.length === 0))) return undefined as never
      return this.receivedShares.map((share) => {
      return { share, span_text: ((this.tab === 'received') && (!(this.loadingReceived && this.receivedShares.length === 0)) && (!(this.receivedShares.length === 0))) ? (share.item_name ?? 'Élément') : undefined, p_text: ((this.tab === 'received') && (!(this.loadingReceived && this.receivedShares.length === 0)) && (!(this.receivedShares.length === 0))) ? ("Partagé par " + String(share.owner_name ?? 'quelqu’un')) : undefined, span_text2: ((this.tab === 'received') && (!(this.loadingReceived && this.receivedShares.length === 0)) && (!(this.receivedShares.length === 0))) ? (share.item_kind === 'folder' ? 'Dossier' : 'Fichier') : undefined, key: share.id }
    })
    })
  }

  get visible3() {
    return this.memo('visible3', [this.show_received_shares, this.show_not_loading_received_received_shares, this.tab], () => {
      if (!(this.tab === 'received')) return undefined as never
      return this.show_received_shares && this.show_not_loading_received_received_shares
    })
  }

  get visible4() {
    return this.memo('visible4', [this.show_not_received_shares, this.show_not_loading_received_received_shares, this.tab], () => {
      if (!(this.tab === 'received')) return undefined as never
      return this.show_not_received_shares && this.show_not_loading_received_received_shares
    })
  }

  panel_click(_sender: unknown, _args: MouseEventArgs) {
    this.props.onClose?.()
  }

  panel_click2(_sender: unknown, _args: MouseEventArgs) {
    this.props.onClose?.()
  }

  panel_click3(_sender: unknown, _args: MouseEventArgs) {
    if (!(this.props.target)) return undefined as never
    this.setTab('new')
  }

  panel_click4(_sender: unknown, _args: MouseEventArgs) {
    this.setTab('mine')
  }

  panel_click5(_sender: unknown, _args: MouseEventArgs) {
    this.setTab('received')
  }

  button_click(_sender: unknown, _args: MouseEventArgs) {
    if (!(this.tab === 'new' && this.props.target)) return undefined as never
    void this.handleCreate()
  }

  button_click2(_sender: unknown, args: MouseEventArgs) {
    const { share } = args.row as RowOf_rows_my_shares
    if (!(this.tab === 'mine') || !(!(this.loadingMine && this.myShares.length === 0)) || !(!(this.myShares.length === 0))) return undefined as never
    void this.handleRevoke(share.id)
  }

  button_click3(_sender: unknown, _args: MouseEventArgs) {
    this.props.onClose?.()
  }

  /** `setCanDownload` of the TSX: a value, or an update of the previous one. */
  setCanDownload(value: AdvancedShareDialog['canDownload'] | ((prev: AdvancedShareDialog['canDownload']) => AdvancedShareDialog['canDownload'])) {
    this.canDownload = typeof value === 'function' ? (value as (prev: AdvancedShareDialog['canDownload']) => AdvancedShareDialog['canDownload'])(this.canDownload) : value
  }

  /** `setCanUpload` of the TSX: a value, or an update of the previous one. */
  setCanUpload(value: AdvancedShareDialog['canUpload'] | ((prev: AdvancedShareDialog['canUpload']) => AdvancedShareDialog['canUpload'])) {
    this.canUpload = typeof value === 'function' ? (value as (prev: AdvancedShareDialog['canUpload']) => AdvancedShareDialog['canUpload'])(this.canUpload) : value
  }

  /** `setCanDelete` of the TSX: a value, or an update of the previous one. */
  setCanDelete(value: AdvancedShareDialog['canDelete'] | ((prev: AdvancedShareDialog['canDelete']) => AdvancedShareDialog['canDelete'])) {
    this.canDelete = typeof value === 'function' ? (value as (prev: AdvancedShareDialog['canDelete']) => AdvancedShareDialog['canDelete'])(this.canDelete) : value
  }

  /** `setPwEnabled` of the TSX: a value, or an update of the previous one. */
  setPwEnabled(value: AdvancedShareDialog['pwEnabled'] | ((prev: AdvancedShareDialog['pwEnabled']) => AdvancedShareDialog['pwEnabled'])) {
    this.pwEnabled = typeof value === 'function' ? (value as (prev: AdvancedShareDialog['pwEnabled']) => AdvancedShareDialog['pwEnabled'])(this.pwEnabled) : value
  }

  /** `setExpEnabled` of the TSX: a value, or an update of the previous one. */
  setExpEnabled(value: AdvancedShareDialog['expEnabled'] | ((prev: AdvancedShareDialog['expEnabled']) => AdvancedShareDialog['expEnabled'])) {
    this.expEnabled = typeof value === 'function' ? (value as (prev: AdvancedShareDialog['expEnabled']) => AdvancedShareDialog['expEnabled'])(this.expEnabled) : value
  }

  /** `setExpiresAt` of the TSX: a value, or an update of the previous one. */
  setExpiresAt(value: AdvancedShareDialog['expiresAt'] | ((prev: AdvancedShareDialog['expiresAt']) => AdvancedShareDialog['expiresAt'])) {
    this.expiresAt = typeof value === 'function' ? (value as (prev: AdvancedShareDialog['expiresAt']) => AdvancedShareDialog['expiresAt'])(this.expiresAt) : value
  }

  /** `setMaxEnabled` of the TSX: a value, or an update of the previous one. */
  setMaxEnabled(value: AdvancedShareDialog['maxEnabled'] | ((prev: AdvancedShareDialog['maxEnabled']) => AdvancedShareDialog['maxEnabled'])) {
    this.maxEnabled = typeof value === 'function' ? (value as (prev: AdvancedShareDialog['maxEnabled']) => AdvancedShareDialog['maxEnabled'])(this.maxEnabled) : value
  }

  /** `setMaxDownloads` of the TSX: a value, or an update of the previous one. */
  setMaxDownloads(value: AdvancedShareDialog['maxDownloads'] | ((prev: AdvancedShareDialog['maxDownloads']) => AdvancedShareDialog['maxDownloads'])) {
    this.maxDownloads = typeof value === 'function' ? (value as (prev: AdvancedShareDialog['maxDownloads']) => AdvancedShareDialog['maxDownloads'])(this.maxDownloads) : value
  }

}

type RowOf_rows_my_shares = AdvancedShareDialog['rows_my_shares'][number]

/** What `useHooks()` gives (the types of the fields it fills). */
export type AdvancedShareDialogHooks = ReturnType<AdvancedShareDialog['useHooks']>

export default AdvancedShareDialog.component()
