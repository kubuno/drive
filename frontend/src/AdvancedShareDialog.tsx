import { useState, useEffect, useCallback } from 'react'
import { api } from '@kubuno/sdk'
import { formatSize } from '@kubuno/drive'
import { Button, Input } from '@ui'
import {
  Share2,
  Link,
  Copy,
  Trash2,
  Lock,
  Calendar,
  Download,
  X,
  Check,
  Inbox,
} from 'lucide-react'

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

// Build the public share URL for a given token.
function shareUrl(token: string): string {
  return `${window.location.origin}/api/v1/drive/share/${token}`
}

// Format an ISO date string into a short readable French date.
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export default function AdvancedShareDialog({ target, onClose }: Props) {
  const [tab, setTab] = useState<Tab>(target ? 'new' : 'mine')

  // ── Creation form state ──────────────────────────────────────────────
  const [canDownload, setCanDownload] = useState(true)
  const [canUpload, setCanUpload] = useState(false)
  const [canDelete, setCanDelete] = useState(false)
  const [pwEnabled, setPwEnabled] = useState(false)
  const [password, setPassword] = useState('')
  const [expEnabled, setExpEnabled] = useState(false)
  const [expiresAt, setExpiresAt] = useState('')
  const [maxEnabled, setMaxEnabled] = useState(false)
  const [maxDownloads, setMaxDownloads] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createdUrl, setCreatedUrl] = useState<string | null>(null)
  const [createdCopied, setCreatedCopied] = useState(false)

  // ── Lists state ──────────────────────────────────────────────────────
  const [myShares, setMyShares] = useState<Share[]>([])
  const [receivedShares, setReceivedShares] = useState<Share[]>([])
  const [loadingMine, setLoadingMine] = useState(false)
  const [loadingReceived, setLoadingReceived] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const loadMine = useCallback(async () => {
    setLoadingMine(true)
    try {
      const { data } = await api.get<{ shares: Share[] }>('/drive/shares')
      setMyShares(data.shares.filter(s => s.token !== null))
    } catch {
      // Best-effort: keep whatever we had.
    } finally {
      setLoadingMine(false)
    }
  }, [])

  const loadReceived = useCallback(async () => {
    setLoadingReceived(true)
    try {
      const { data } = await api.get<{ shares: Share[] }>('/drive/shares/received')
      setReceivedShares(data.shares)
    } catch {
      // Best-effort.
    } finally {
      setLoadingReceived(false)
    }
  }, [])

  useEffect(() => {
    void loadMine()
    void loadReceived()
  }, [loadMine, loadReceived])

  // ── Creation ─────────────────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    if (!target) return
    setCreating(true)
    setCreateError(null)
    setCreatedUrl(null)
    setCreatedCopied(false)
    try {
      const body: Record<string, unknown> = {
        [target.kind === 'folder' ? 'folder_id' : 'file_id']: target.id,
        can_download: canDownload,
        can_upload: canUpload,
        can_delete: canDelete,
      }
      if (pwEnabled && password) body.password = password
      if (expEnabled && expiresAt) body.expires_at = new Date(expiresAt).toISOString()
      if (maxEnabled && maxDownloads) body.max_downloads = Number(maxDownloads)

      const { data } = await api.post<{ share: { token: string | null } }>(
        '/drive/shares',
        body,
      )

      if (data.share.token) {
        const url = shareUrl(data.share.token)
        setCreatedUrl(url)
        try {
          await navigator.clipboard.writeText(url)
          setCreatedCopied(true)
        } catch {
          // Clipboard may be unavailable; the link is still shown.
        }
      }
      void loadMine()
    } catch {
      setCreateError('La création du lien a échoué. Veuillez réessayer.')
    } finally {
      setCreating(false)
    }
  }, [
    target,
    canDownload,
    canUpload,
    canDelete,
    pwEnabled,
    password,
    expEnabled,
    expiresAt,
    maxEnabled,
    maxDownloads,
    loadMine,
  ])

  // ── Copy / revoke for existing links ─────────────────────────────────
  const handleCopy = useCallback(async (share: Share) => {
    if (!share.token) return
    try {
      await navigator.clipboard.writeText(shareUrl(share.token))
      setCopiedId(share.id)
      window.setTimeout(() => {
        setCopiedId(prev => (prev === share.id ? null : prev))
      }, 1500)
    } catch {
      // Ignore clipboard failures.
    }
  }, [])

  const handleRevoke = useCallback(async (id: string) => {
    try {
      await api.delete(`/drive/shares/${id}`)
      setMyShares(prev => prev.filter(s => s.id !== id))
    } catch {
      // Best-effort: leave the list untouched on failure.
    }
  }, [])

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[88vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Share2 size={20} className="text-primary" />
            <h2 className="text-lg font-semibold text-text-primary">Partage</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-surface-2 text-text-secondary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-border mb-4">
          {target && (
            <button
              onClick={() => setTab('new')}
              className={`px-3 py-2 text-sm font-medium -mb-px transition-colors ${
                tab === 'new'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Nouveau lien
            </button>
          )}
          <button
            onClick={() => setTab('mine')}
            className={`px-3 py-2 text-sm font-medium -mb-px transition-colors ${
              tab === 'mine'
                ? 'text-primary border-b-2 border-primary'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Mes liens
          </button>
          <button
            onClick={() => setTab('received')}
            className={`px-3 py-2 text-sm font-medium -mb-px transition-colors ${
              tab === 'received'
                ? 'text-primary border-b-2 border-primary'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Partagés avec moi
          </button>
        </div>

        {/* ── Tab: Nouveau lien ─────────────────────────────────────── */}
        {tab === 'new' && target && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Partager : <span className="font-medium text-text-primary">{target.name}</span>
            </p>

            {/* Permissions */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                Permissions
              </p>
              <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={canDownload}
                  onChange={e => setCanDownload(e.target.checked)}
                />
                Autoriser le téléchargement
              </label>
              <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={canUpload}
                  onChange={e => setCanUpload(e.target.checked)}
                />
                Autoriser l’envoi de fichiers
              </label>
              <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={canDelete}
                  onChange={e => setCanDelete(e.target.checked)}
                />
                Autoriser la suppression
              </label>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={pwEnabled}
                  onChange={e => setPwEnabled(e.target.checked)}
                />
                Protéger par un mot de passe
              </label>
              {pwEnabled && (
                <Input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Mot de passe"
                />
              )}
            </div>

            {/* Expiration */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={expEnabled}
                  onChange={e => setExpEnabled(e.target.checked)}
                />
                Date d’expiration
              </label>
              {expEnabled && (
                <Input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={e => setExpiresAt(e.target.value)}
                />
              )}
            </div>

            {/* Max downloads */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={maxEnabled}
                  onChange={e => setMaxEnabled(e.target.checked)}
                />
                Limiter le nombre de téléchargements
              </label>
              {maxEnabled && (
                <Input
                  type="number"
                  min={1}
                  value={maxDownloads}
                  onChange={e => setMaxDownloads(e.target.value)}
                  placeholder="Nombre maximum"
                />
              )}
            </div>

            {createError && (
              <p className="text-sm text-danger bg-danger-light rounded-lg px-3 py-2">
                {createError}
              </p>
            )}

            {/* Created link box */}
            {createdUrl && (
              <div className="bg-surface-1 border border-border rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <Link size={16} className="text-primary shrink-0" />
                  <span className="truncate text-text-primary">{createdUrl}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-tertiary">
                    {createdCopied ? 'Lien copié dans le presse-papier' : 'Lien créé'}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={createdCopied ? <Check size={14} /> : <Copy size={14} />}
                    onClick={() => void handleCopy({ ...EMPTY_SHARE, id: 'created', token: extractToken(createdUrl) })}
                  >
                    Copier
                  </Button>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-1">
              <Button variant="primary" loading={creating} onClick={() => void handleCreate()}>
                Créer le lien
              </Button>
            </div>
          </div>
        )}

        {/* ── Tab: Mes liens ────────────────────────────────────────── */}
        {tab === 'mine' && (
          <div className="space-y-3">
            {loadingMine && myShares.length === 0 ? (
              <p className="text-sm text-text-tertiary py-6 text-center">Chargement…</p>
            ) : myShares.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-text-tertiary">
                <Link size={28} />
                <p className="text-sm">Aucun lien actif</p>
              </div>
            ) : (
              myShares.map(share => (
                <div
                  key={share.id}
                  className="bg-surface-1 border border-border rounded-lg p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <Link size={16} className="text-primary shrink-0" />
                    <span className="text-sm font-medium text-text-primary truncate">
                      {share.item_name ?? 'Élément'}
                    </span>
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                    {share.password_protected && (
                      <span className="inline-flex items-center gap-1 bg-surface-2 rounded px-1.5 py-0.5">
                        <Lock size={12} /> Protégé
                      </span>
                    )}
                    {share.expires_at && (
                      <span className="inline-flex items-center gap-1 bg-surface-2 rounded px-1.5 py-0.5">
                        <Calendar size={12} /> {formatDate(share.expires_at)}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 bg-surface-2 rounded px-1.5 py-0.5">
                      <Download size={12} /> {share.download_count}/{share.max_downloads ?? '∞'}
                    </span>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={copiedId === share.id ? <Check size={14} /> : <Copy size={14} />}
                      onClick={() => void handleCopy(share)}
                    >
                      Copier
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      icon={<Trash2 size={14} />}
                      onClick={() => void handleRevoke(share.id)}
                    >
                      Révoquer
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Tab: Partagés avec moi ────────────────────────────────── */}
        {tab === 'received' && (
          <div className="space-y-3">
            {loadingReceived && receivedShares.length === 0 ? (
              <p className="text-sm text-text-tertiary py-6 text-center">Chargement…</p>
            ) : receivedShares.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-text-tertiary">
                <Inbox size={28} />
                <p className="text-sm">Rien ne vous a été partagé</p>
              </div>
            ) : (
              receivedShares.map(share => (
                <div
                  key={share.id}
                  className="bg-surface-1 border border-border rounded-lg p-3 space-y-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary truncate">
                      {share.item_name ?? 'Élément'}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary">
                    Partagé par {share.owner_name ?? 'quelqu’un'}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
                    <span className="bg-surface-2 rounded px-1.5 py-0.5">
                      {share.item_kind === 'folder' ? 'Dossier' : 'Fichier'}
                    </span>
                    {share.can_download && (
                      <span className="inline-flex items-center gap-1 bg-surface-2 rounded px-1.5 py-0.5">
                        <Download size={12} /> Téléchargement
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end pt-5">
          <Button variant="secondary" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </div>
  )
}

// Extract the token portion from a built share URL.
function extractToken(url: string): string {
  const parts = url.split('/')
  return parts[parts.length - 1] ?? ''
}

// Placeholder Share used to reuse handleCopy for the freshly created link box.
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
