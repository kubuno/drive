import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Server, Plus, Pencil, Trash2, Zap, CheckCircle2, AlertCircle, WifiOff,
  Loader2, ChevronDown, ChevronUp, HardDrive, ListTree,
} from 'lucide-react'
import { filesApi, formatSize, type RemoteConnection, type CreateRemoteDto } from '@kubuno/drive'
import { useFilesStore } from '@kubuno/drive'
import { Button, Dropdown, FloatingWindow, Input, Textarea } from '@ui'
import { useConfirm } from '@kubuno/sdk'
import { getRemoteConfig, listSmbShares, updateRemote } from './remotesApi'
import { ProviderIcon } from './remoteProviderIcons'
import { ConfirmDialog } from '@ui'

// ── Provider catalog ──────────────────────────────────────────────────────────

type ProviderDef = {
  value:   string
  label:   string
  fields:  FieldDef[]
}

type FieldDef = {
  key:         string
  label:       string        // i18n key (rs.f_*)
  type:        'text' | 'password' | 'number' | 'textarea'
  placeholder: string        // literal example (language-neutral)
  phKey?:      string        // i18n key for descriptive placeholders
  required?:   boolean
}

const PROVIDERS: ProviderDef[] = [
  {
    value: 'webdav',
    label: 'WebDAV',
    fields: [
      { key: 'url',      label: 'rs.f_server_url', type: 'text',     placeholder: 'https://dav.example.com/remote.php/dav/files/user/', required: true },
      { key: 'username', label: 'rs.f_username',   type: 'text',     placeholder: '', phKey: 'rs.ph_username' },
      { key: 'password', label: 'rs.f_password',   type: 'password', placeholder: '••••••••' },
      { key: 'base_path', label: 'rs.f_base_path', type: 'text',     placeholder: '/' },
    ],
  },
  {
    value: 'nextcloud',
    label: 'Nextcloud',
    fields: [
      { key: 'url',      label: 'rs.f_nextcloud_url',     type: 'text',     placeholder: 'https://nextcloud.example.com', required: true },
      { key: 'username', label: 'rs.f_username',          type: 'text',     placeholder: '', phKey: 'rs.ph_username' },
      { key: 'password', label: 'rs.f_password_or_token', type: 'password', placeholder: '••••••••' },
      { key: 'base_path', label: 'rs.f_base_path',        type: 'text',     placeholder: '/' },
    ],
  },
  {
    value: 'owncloud',
    label: 'ownCloud',
    fields: [
      { key: 'url',      label: 'rs.f_owncloud_url', type: 'text',     placeholder: 'https://owncloud.example.com', required: true },
      { key: 'username', label: 'rs.f_username',     type: 'text',     placeholder: '', phKey: 'rs.ph_username' },
      { key: 'password', label: 'rs.f_password',     type: 'password', placeholder: '••••••••' },
      { key: 'base_path', label: 'rs.f_base_path',   type: 'text',     placeholder: '/' },
    ],
  },
  {
    value: 'sftp',
    label: 'SFTP',
    fields: [
      { key: 'host',        label: 'rs.f_host',     type: 'text',     placeholder: 'sftp.example.com', required: true },
      { key: 'port',        label: 'rs.f_port',     type: 'number',   placeholder: '22' },
      { key: 'username',    label: 'rs.f_username', type: 'text',     placeholder: '', phKey: 'rs.ph_username' },
      { key: 'password',    label: 'rs.f_password', type: 'password', placeholder: '', phKey: 'rs.ph_pwd_ssh' },
      { key: 'private_key', label: 'rs.f_ssh_key',  type: 'textarea', placeholder: '-----BEGIN OPENSSH PRIVATE KEY-----\n...' },
      { key: 'base_path',   label: 'rs.f_base_path', type: 'text',    placeholder: '/home/user' },
    ],
  },
  {
    value: 'ftp',
    label: 'FTP',
    fields: [
      { key: 'host',      label: 'rs.f_host',     type: 'text',     placeholder: 'ftp.example.com', required: true },
      { key: 'port',      label: 'rs.f_port',     type: 'number',   placeholder: '21' },
      { key: 'username',  label: 'rs.f_username', type: 'text',     placeholder: '', phKey: 'rs.ph_username' },
      { key: 'password',  label: 'rs.f_password', type: 'password', placeholder: '••••••••' },
      { key: 'base_path', label: 'rs.f_base_path', type: 'text',    placeholder: '/' },
    ],
  },
  {
    value: 'smb',
    label: 'SMB / Windows',
    fields: [
      { key: 'host',       label: 'rs.f_host_ip',    type: 'text',     placeholder: '192.168.1.10', required: true },
      { key: 'share_name', label: 'rs.f_share_name', type: 'text',     placeholder: 'Documents', required: true },
      { key: 'username',   label: 'rs.f_username',   type: 'text',     placeholder: '', phKey: 'rs.ph_username' },
      { key: 'password',   label: 'rs.f_password',   type: 'password', placeholder: '••••••••' },
      { key: 'domain',     label: 'rs.f_domain',     type: 'text',     placeholder: 'WORKGROUP' },
      { key: 'base_path',  label: 'rs.f_base_path',  type: 'text',     placeholder: '/' },
    ],
  },
  {
    value: 'nfs',
    label: 'NFS',
    fields: [
      { key: 'host',        label: 'rs.f_host_ip',     type: 'text', placeholder: '192.168.1.10', required: true },
      { key: 'export_path', label: 'rs.f_nfs_export',  type: 'text', placeholder: '/srv/partage', required: true },
      { key: 'base_path',   label: 'rs.f_base_path',   type: 'text', placeholder: '/' },
    ],
  },
  {
    value: 'gdrive',
    label: 'Google Drive',
    fields: [
      { key: 'client_id',     label: 'rs.f_client_id',     type: 'text',     placeholder: '1234…apps.googleusercontent.com', required: true },
      { key: 'client_secret', label: 'rs.f_client_secret', type: 'password', placeholder: 'GOC…', required: true },
      { key: 'access_token',  label: 'rs.f_access_token',  type: 'password', placeholder: 'ya29…' },
      { key: 'refresh_token', label: 'rs.f_refresh_token', type: 'password', placeholder: '1//0…' },
      { key: 'base_path',     label: 'rs.f_base_path',     type: 'text',     placeholder: '/' },
    ],
  },
  {
    value: 'dropbox',
    label: 'Dropbox',
    fields: [
      { key: 'access_token', label: 'rs.f_access_token', type: 'password', placeholder: 'sl.…', required: true },
      { key: 'base_path',    label: 'rs.f_base_path',    type: 'text',     placeholder: '/' },
    ],
  },
]

function providerDef(value: string): ProviderDef {
  return PROVIDERS.find(p => p.value === value) ?? PROVIDERS[0]
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: RemoteConnection['status'] }) {
  const { t } = useTranslation('drive')
  if (status === 'connected') return (
    <span className="flex items-center gap-1 text-xs text-success bg-success/10 px-2 py-0.5 rounded-full">
      <CheckCircle2 size={11} /> {t('rs.st_connected')}
    </span>
  )
  if (status === 'error') return (
    <span className="flex items-center gap-1 text-xs text-danger bg-danger/10 px-2 py-0.5 rounded-full">
      <AlertCircle size={11} /> {t('rs.st_error')}
    </span>
  )
  return (
    <span className="flex items-center gap-1 text-xs text-text-tertiary bg-surface-2 px-2 py-0.5 rounded-full">
      <WifiOff size={11} /> {t('rs.st_disconnected')}
    </span>
  )
}

// ── Connection row ────────────────────────────────────────────────────────────

function ConnectionRow({ conn }: { conn: RemoteConnection }) {
  const { t, i18n } = useTranslation('drive')
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [editing,  setEditing]  = useState(false)
  const def = providerDef(conn.provider)
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()

  const testMutation = useMutation({
    mutationFn: () => filesApi.testRemote(conn.id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['remotes'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: () => filesApi.deleteRemote(conn.id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['remotes'] }),
  })

  const testResult = testMutation.data

  return (
    <div className="rounded-xl border border-border bg-white overflow-hidden group">
      {/* Header row */}
      <div className="flex items-center gap-3 p-3">
        <div className="w-9 h-9 rounded-lg bg-surface-2 flex items-center justify-center text-lg flex-shrink-0">
          <ProviderIcon provider={conn.provider} size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-text-primary">{conn.name}</span>
            <span className="text-xs text-text-tertiary bg-surface-2 px-1.5 py-0.5 rounded-md">
              {def.label}
            </span>
            <StatusBadge status={conn.status} />
          </div>
          <p className="text-xs text-text-tertiary mt-0.5 font-mono">
            /remotes/{conn.mount_name}
          </p>
        </div>
        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            title={t('rs.test_title')}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-text-secondary hover:text-primary transition-colors disabled:opacity-50"
          >
            {testMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
          </button>
          <button
            onClick={() => setEditing(v => !v)}
            title={t('rs.edit_title_short')}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-text-secondary hover:text-primary transition-colors"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={() => setExpanded(v => !v)}
            title={expanded ? t('rs.collapse') : t('rs.details')}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-text-secondary transition-colors"
          >
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          <button
            onClick={async () => {
              const ok = await confirm({
                title:        t('rs.del_confirm_title', { name: conn.name }),
                message:      t('rs.del_confirm_msg'),
                confirmLabel: t('rs.del_title'),
                variant:      'danger',
              })
              if (ok) deleteMutation.mutate()
            }}
            disabled={deleteMutation.isPending}
            title={t('rs.del_title')}
            className="p-1.5 rounded-lg hover:bg-danger/10 text-text-secondary hover:text-danger transition-colors disabled:opacity-50"
          >
            {deleteMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
          </button>
          {confirmState && (
            <ConfirmDialog {...confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
          )}
        </div>
      </div>

      {/* Test result */}
      {testResult && (
        <div className={`mx-3 mb-2 px-3 py-2 rounded-lg text-xs ${testResult.ok ? 'bg-success/5 text-success border border-success/20' : 'bg-danger/5 text-danger border border-danger/20'}`}>
          {testResult.ok ? (
            <>
              {t('rs.test_ok')}
              {testResult.quota?.used_bytes != null && testResult.quota?.total_bytes != null && (
                <> {t('rs.test_used', { used: formatSize(testResult.quota.used_bytes), total: formatSize(testResult.quota.total_bytes) })}</>
              )}
            </>
          ) : testResult.error}
        </div>
      )}

      {/* Error detail */}
      {conn.last_error && conn.status === 'error' && !testResult && (
        <div className="mx-3 mb-2 px-3 py-2 rounded-lg text-xs bg-danger/5 text-danger border border-danger/20">
          {conn.last_error}
        </div>
      )}

      {/* Inline edit — in place on the row, not in a modal. */}
      {editing && (
        <div className="px-3 pb-3">
          <ConnectionForm
            existing={conn}
            onCancel={() => setEditing(false)}
            onSaved={() => setEditing(false)}
          />
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-1 text-xs text-text-secondary bg-surface-1">
          {conn.last_connected_at && (
            <div className="flex justify-between">
              <span>{t('rs.last_conn')}</span>
              <span className="text-text-primary">{new Date(conn.last_connected_at).toLocaleString(i18n.language)}</span>
            </div>
          )}
          {conn.remote_quota_bytes != null && (
            <div className="flex justify-between">
              <span>{t('rs.remote_quota')}</span>
              <span className="text-text-primary">{formatSize(conn.remote_quota_bytes)}</span>
            </div>
          )}
          {conn.remote_used_bytes != null && (
            <div className="flex justify-between">
              <span>{t('rs.used')}</span>
              <span className="text-text-primary">{formatSize(conn.remote_used_bytes)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>{t('rs.added_on')}</span>
            <span className="text-text-primary">{new Date(conn.created_at).toLocaleDateString(i18n.language)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Add connection form ───────────────────────────────────────────────────────

/**
 * Creates a mount, or edits an existing one.
 *
 * Editing prefills what the owner typed — host, share, username, domain, paths —
 * and leaves ONLY the secrets blank, because those never leave the server. A
 * blank secret therefore means "keep the current one", which is what lets a user
 * fix a typo in the host without re-typing the password. The provider is frozen:
 * swapping it would mean a different set of fields, i.e. another mount.
 *
 * A mount whose config cannot be decrypted has nothing to prefill; the form then
 * falls back to a full re-entry and says so.
 */
function ConnectionForm({ existing, onCancel, onSaved }: {
  existing?: RemoteConnection
  onCancel:  () => void
  onSaved:   () => void
}) {
  const { t } = useTranslation('drive')
  const qc = useQueryClient()
  const editing = existing !== undefined
  const [name,     setName]     = useState(existing?.name ?? '')
  const [provider, setProvider] = useState(existing?.provider ?? 'webdav')
  const [fields,   setFields]   = useState<Record<string, string>>({})
  const [prefilled, setPrefilled] = useState(false)

  const { data: stored, isLoading: loadingCfg, error: cfgError } = useQuery({
    queryKey: ['remote-config', existing?.id],
    queryFn:  () => getRemoteConfig(existing!.id),
    enabled:  editing,
    retry:    false,
    staleTime: 0,
    gcTime:   0,
  })

  // Prefill once: re-running on every render would fight the user's typing.
  useEffect(() => {
    if (!stored || prefilled) return
    const next: Record<string, string> = {}
    for (const [k, v] of Object.entries(stored.config)) {
      if (v !== null && v !== undefined) next[k] = String(v)
    }
    setFields(next)
    setPrefilled(true)
  }, [stored, prefilled])

  const secretsSet = stored?.secrets_set ?? []
  const unreadable = (cfgError as { code?: string } | null)?.code === 'MOUNT_CONFIG_UNREADABLE'

  const def = providerDef(provider)

  // Share discovery: a server's share NAME and its COMMENT differ, and typing
  // the comment is what fails with "partage introuvable".
  const shares = useMutation({
    mutationFn: () => listSmbShares({
      host:     (fields.host ?? '').trim(),
      username: (fields.username ?? '').trim() || undefined,
      password: (fields.password ?? '').trim() || undefined,
      domain:   (fields.domain ?? '').trim() || undefined,
      mountId:  existing?.id,
    }),
  })

  const setField = (key: string, value: string) =>
    setFields(prev => ({ ...prev, [key]: value }))

  const handleProviderChange = (p: string) => {
    setProvider(p)
    setFields({})
  }

  const mutation = useMutation({
    mutationFn: () => {
      const config: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(fields)) {
        if (v.trim()) {
          config[k] = def.fields.find(f => f.key === k)?.type === 'number'
            ? Number(v)
            : v.trim()
        }
      }
      if (existing) return updateRemote(existing.id, { name: name.trim(), config })
      const dto: CreateRemoteDto = { name: name.trim(), provider, config }
      return filesApi.createRemote(dto).then(() => undefined)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['remotes'] })
      onSaved()
    },
  })

  // A required secret already stored counts as satisfied: leaving it blank keeps it.
  const canSubmit = name.trim().length > 0 &&
    def.fields.filter(f => f.required).every(f =>
      (fields[f.key] ?? '').trim().length > 0 || secretsSet.includes(f.key))

  return (
    <div className="bg-surface-1 rounded-xl border border-border p-4 mt-2">
      <h3 className="text-sm font-semibold text-text-primary mb-3">
        {editing ? t('rs.edit_title', { name: existing.name }) : t('rs.new_title')}
      </h3>

      {editing && (
        <p className="text-xs text-text-secondary bg-surface-2 border border-border rounded-lg px-3 py-2 mb-3">
          {loadingCfg ? t('common.loading')
            : unreadable ? t('rs.edit_hint')
            : t('rs.edit_hint_kept')}
        </p>
      )}

      <div className="space-y-3">
        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">
            {t('rs.name_label')} <span className="text-danger">*</span>
          </label>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('rs.name_ph')}
            autoFocus
          />
        </div>

        {/* Provider — frozen while editing (see the component's doc comment). */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">{t('rs.type_label')}</label>
          {editing ? (
            <p className="text-sm text-text-primary px-3 py-2 rounded-lg bg-surface-2 border border-border">
              <span className="inline-flex items-center gap-2"><ProviderIcon provider={provider} size={16} />{def.label}</span>
            </p>
          ) : (
            <Dropdown
              value={provider}
              onChange={v => handleProviderChange(v)}
              options={PROVIDERS.map(p => ({ value: p.value, label: p.label, icon: <ProviderIcon provider={p.value} size={16} /> }))}
            />
          )}
        </div>

        {/* Provider-specific fields */}
        {def.fields.map(f => {
          // A secret already on file: say so in the placeholder rather than show
          // a fake value, so "blank = keep" reads as deliberate, not forgotten.
          const kept = secretsSet.includes(f.key)
          const ph = kept ? t('rs.field_unchanged') : (f.phKey ? t(f.phKey) : f.placeholder)
          return (
            <div key={f.key}>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                {t(f.label)} {f.required && !kept && <span className="text-danger">*</span>}
              </label>
              {f.type === 'textarea' ? (
                <Textarea
                  value={fields[f.key] ?? ''}
                  onChange={e => setField(f.key, e.target.value)}
                  placeholder={ph}
                  rows={4}
                  className="font-mono"
                />
              ) : (
                <Input
                  type={f.type}
                  value={fields[f.key] ?? ''}
                  onChange={e => setField(f.key, e.target.value)}
                  placeholder={ph}
                />
              )}

              {f.key === 'share_name' && provider === 'smb' && (
                <div className="mt-1.5">
                  <button
                    type="button"
                    onClick={() => shares.mutate()}
                    disabled={!(fields.host ?? '').trim() || shares.isPending}
                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline disabled:opacity-50 disabled:no-underline"
                  >
                    {shares.isPending
                      ? <Loader2 size={13} className="animate-spin" />
                      : <ListTree size={13} />}
                    {t('rs.list_shares')}
                  </button>

                  {shares.isError && (
                    <p className="mt-1 text-xs text-danger">
                      {(shares.error as { message?: string })?.message ?? t('rs.shares_failed')}
                    </p>
                  )}
                  {shares.isSuccess && shares.data.length === 0 && (
                    <p className="mt-1 text-xs text-text-tertiary">{t('rs.shares_none')}</p>
                  )}
                  {shares.isSuccess && shares.data.length > 0 && (
                    <ul className="mt-1.5 rounded-lg border border-border divide-y divide-border overflow-hidden">
                      {shares.data.map(s => (
                        <li key={s.name}>
                          <button
                            type="button"
                            onClick={() => setField('share_name', s.name)}
                            className={`w-full text-left px-2.5 py-1.5 hover:bg-surface-2 transition-colors ${
                              fields.share_name === s.name ? 'bg-primary/5' : ''
                            }`}
                          >
                            {/* Name first and in code type: it is the value that
                                goes in the field. The comment is only a label. */}
                            <span className="font-mono text-xs text-text-primary">{s.name}</span>
                            {s.comment && (
                              <span className="ml-2 text-xs text-text-tertiary">{s.comment}</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {mutation.isError && (
          <p className="text-xs text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">
            {/* The API client flattens failures to a bare { code, message }, so
                the server's reason lives at the root — reading `response.data`
                here always fell through to the generic label. */}
            {(mutation.error as { message?: string })?.message ?? t('rs.err_create')}
          </p>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={mutation.isPending}>{t('common.cancel')}</Button>
          <Button size="sm" onClick={() => mutation.mutate()} disabled={!canSubmit} loading={mutation.isPending}>
            {editing ? t('rs.save_btn') : t('rs.create_btn')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function RemoteStoragePanel() {
  const { t } = useTranslation('drive')
  const { remotesPanelOpen, closeRemotesPanel } = useFilesStore()
  const [showAdd, setShowAdd] = useState(false)

  const { data: connections = [], isLoading } = useQuery({
    queryKey: ['remotes'],
    queryFn:  filesApi.listRemotes,
    enabled:  remotesPanelOpen,
  })

  if (!remotesPanelOpen) return null

  // A floating window, not a full-height drawer: managing mounts is a side
  // errand, and the drawer's backdrop hid the very files the user was placing.
  // No footer — nothing here is confirmed, each row acts on its own.
  return (
    <FloatingWindow
      title={t('rs.panel_title')}
      icon={<Server size={17} className="text-primary" />}
      onClose={closeRemotesPanel}
      defaultWidth={560}
      defaultHeight={620}
      minWidth={420}
      minHeight={360}
      resizable
    >
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-primary" />
            </div>
          ) : connections.length === 0 && !showAdd ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <HardDrive size={40} className="text-text-tertiary mb-3" />
              <p className="text-sm font-medium text-text-primary">{t('rs.empty_title')}</p>
              <p className="text-xs text-text-secondary mt-1 max-w-xs">
                {t('rs.empty_desc')}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {connections.map(conn => (
                <ConnectionRow key={conn.id} conn={conn} />
              ))}
            </div>
          )}

          {showAdd
            ? <ConnectionForm onCancel={() => setShowAdd(false)} onSaved={() => setShowAdd(false)} />
            : (
              <button
                onClick={() => setShowAdd(true)}
                className="mt-4 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-border text-sm text-text-secondary hover:text-primary hover:border-primary hover:bg-primary/5 transition-colors"
              >
                <Plus size={16} /> {t('rs.add_btn')}
              </button>
            )
          }
        </div>
    </FloatingWindow>
  )
}
