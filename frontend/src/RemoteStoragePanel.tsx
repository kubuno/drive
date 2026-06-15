import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  X, Server, Plus, Trash2, Zap, CheckCircle2, AlertCircle, WifiOff,
  Loader2, ChevronDown, ChevronUp, HardDrive,
} from 'lucide-react'
import { filesApi, formatSize, type RemoteConnection, type CreateRemoteDto } from '@kubuno/drive'
import { useFilesStore } from '@kubuno/drive'
import { Button, Dropdown, Input, Textarea } from '@ui'
import { useConfirm } from '@kubuno/sdk'
import { ConfirmDialog } from '@ui'

// ── Provider catalog ──────────────────────────────────────────────────────────

type ProviderDef = {
  value:   string
  label:   string
  emoji:   string
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
    emoji: '🌐',
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
    emoji: '☁️',
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
    emoji: '☁️',
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
    emoji: '🔐',
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
    emoji: '📂',
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
    emoji: '🪟',
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
    emoji: '🗄️',
    fields: [
      { key: 'host',        label: 'rs.f_host_ip',     type: 'text', placeholder: '192.168.1.10', required: true },
      { key: 'export_path', label: 'rs.f_nfs_export',  type: 'text', placeholder: '/srv/partage', required: true },
      { key: 'base_path',   label: 'rs.f_base_path',   type: 'text', placeholder: '/' },
    ],
  },
  {
    value: 'gdrive',
    label: 'Google Drive',
    emoji: '🔵',
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
    emoji: '📦',
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
          {def.emoji}
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

function AddConnectionForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const { t } = useTranslation('drive')
  const qc = useQueryClient()
  const [name,     setName]     = useState('')
  const [provider, setProvider] = useState('webdav')
  const [fields,   setFields]   = useState<Record<string, string>>({})

  const def = providerDef(provider)

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
      const dto: CreateRemoteDto = { name: name.trim(), provider, config }
      return filesApi.createRemote(dto)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['remotes'] })
      onSaved()
    },
  })

  const canSubmit = name.trim().length > 0 &&
    def.fields.filter(f => f.required).every(f => (fields[f.key] ?? '').trim().length > 0)

  return (
    <div className="bg-surface-1 rounded-xl border border-border p-4 mt-2">
      <h3 className="text-sm font-semibold text-text-primary mb-3">{t('rs.new_title')}</h3>

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

        {/* Provider */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">{t('rs.type_label')}</label>
          <Dropdown
            value={provider}
            onChange={v => handleProviderChange(v)}
            options={PROVIDERS.map(p => ({ value: p.value, label: `${p.emoji} ${p.label}` }))}
          />
        </div>

        {/* Provider-specific fields */}
        {def.fields.map(f => (
          <div key={f.key}>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              {t(f.label)} {f.required && <span className="text-danger">*</span>}
            </label>
            {f.type === 'textarea' ? (
              <Textarea
                value={fields[f.key] ?? ''}
                onChange={e => setField(f.key, e.target.value)}
                placeholder={f.phKey ? t(f.phKey) : f.placeholder}
                rows={4}
                className="font-mono"
              />
            ) : (
              <Input
                type={f.type}
                value={fields[f.key] ?? ''}
                onChange={e => setField(f.key, e.target.value)}
                placeholder={f.phKey ? t(f.phKey) : f.placeholder}
              />
            )}
          </div>
        ))}

        {mutation.isError && (
          <p className="text-xs text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">
            {(mutation.error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('rs.err_create')}
          </p>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={mutation.isPending}>{t('common.cancel')}</Button>
          <Button size="sm" onClick={() => mutation.mutate()} disabled={!canSubmit} loading={mutation.isPending}>
            {t('rs.create_btn')}
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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={closeRemotesPanel} />

      <div className="relative bg-white w-full max-w-md h-full shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Server size={18} className="text-primary" />
            <h2 className="text-base font-semibold text-text-primary">{t('rs.panel_title')}</h2>
          </div>
          <button onClick={closeRemotesPanel} className="p-1.5 rounded-lg hover:bg-surface-2 text-text-secondary transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
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
            ? <AddConnectionForm onCancel={() => setShowAdd(false)} onSaved={() => setShowAdd(false)} />
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
      </div>
    </div>
  )
}
