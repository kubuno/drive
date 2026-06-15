import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@kubuno/sdk'
import { api } from '@kubuno/sdk'
import { Copy, RefreshCw, HardDrive, Check, ExternalLink } from 'lucide-react'
import { Button } from '@ui'

async function fetchWebDavToken(): Promise<string> {
  const { data } = await api.get<{ token: string }>('/drive/webdav-token')
  return data.token
}

async function regenerateWebDavToken(): Promise<string> {
  const { data } = await api.post<{ token: string }>('/drive/webdav-token/regenerate')
  return data.token
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation('drive')
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={copy}
      className="flex-shrink-0 p-1.5 rounded hover:bg-surface-2 text-text-tertiary hover:text-text-primary transition-colors"
      title={t('webdav.copy')}
    >
      {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
    </button>
  )
}

function ConnectRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2 py-2 border-b border-[#f1f3f4] last:border-0">
      <span className="text-sm text-text-tertiary w-28 flex-shrink-0">{label}</span>
      <span className={`flex-1 text-sm text-text-primary min-w-0 truncate ${mono ? 'font-mono bg-surface-2 rounded px-2 py-0.5' : ''}`}>
        {value}
      </span>
      <CopyButton text={value} />
    </div>
  )
}

export default function FilesWebDavSettings() {
  const { t } = useTranslation('drive')
  const user = useAuthStore(s => s.user)
  const qc   = useQueryClient()

  const { data: token, isLoading } = useQuery({
    queryKey: ['webdav-token'],
    queryFn:  fetchWebDavToken,
    staleTime: Infinity,
  })

  const regenMut = useMutation({
    mutationFn: regenerateWebDavToken,
    onSuccess:  (t) => qc.setQueryData(['webdav-token'], t),
  })

  const baseUrl   = window.location.origin
  const webdavUrl = `${baseUrl}/api/v1/drive/webdav/`
  const username  = user?.email ?? ''

  return (
    <div className="mt-8 border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 bg-surface-1 border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
          <HardDrive size={16} className="text-blue-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-text-primary">{t('webdav.title')}</p>
          <p className="text-xs text-text-tertiary">{t('webdav.subtitle')}</p>
        </div>
      </div>

      <div className="px-5 py-4">
        {isLoading ? (
          <p className="text-sm text-text-tertiary py-2">{t('common.loading')}</p>
        ) : (
          <>
            {/* Connection details */}
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-3">
              {t('webdav.creds')}
            </p>
            <ConnectRow label={t('webdav.url')}  value={webdavUrl} />
            <ConnectRow label={t('webdav.user')} value={username} />
            <ConnectRow label={t('webdav.pwd')}  value={token ?? ''} />

            {/* Regen button */}
            <div className="mt-4 flex items-center gap-3">
              <Button
                size="sm"
                variant="secondary"
                icon={<RefreshCw size={13} className={regenMut.isPending ? 'animate-spin' : ''} />}
                onClick={() => regenMut.mutate()}
                loading={regenMut.isPending}
              >
                {t('webdav.regen')}
              </Button>
              <p className="text-xs text-text-tertiary">{t('webdav.regen_hint')}</p>
            </div>

            {/* Instructions */}
            <div className="mt-6 space-y-3">
              <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">
                {t('webdav.how')}
              </p>
              <Instruction
                title="macOS (Finder)"
                steps={[
                  t('webdav.mac_1'),
                  t('webdav.step_enter_url', { url: webdavUrl }),
                  t('webdav.mac_3'),
                  t('webdav.step_enter_creds'),
                ]}
              />
              <Instruction
                title="Windows (Explorateur de fichiers)"
                steps={[
                  t('webdav.win_1'),
                  t('webdav.win_2'),
                  t('webdav.step_enter_url', { url: webdavUrl }),
                  t('webdav.step_enter_creds'),
                ]}
              />
              <Instruction
                title="Linux (Nautilus / Thunar)"
                steps={[
                  t('webdav.linux_1'),
                  t('webdav.linux_2', { host: window.location.host }),
                  t('webdav.step_enter_creds'),
                ]}
              />
              <Instruction
                title={t('webdav.third_title')}
                steps={[
                  t('webdav.third_proto'),
                  t('webdav.third_server', { host: window.location.host }),
                  t('webdav.third_path'),
                  t('webdav.third_user'),
                  t('webdav.third_pwd'),
                ]}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Instruction({ title, steps }: { title: string; steps: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text-primary hover:bg-surface-1 text-left"
      >
        <span>{title}</span>
        <ExternalLink size={13} className="text-text-tertiary flex-shrink-0" />
      </button>
      {open && (
        <ol className="px-4 pb-3 space-y-1.5 border-t border-border bg-surface-1">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2 text-sm text-text-secondary pt-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-semibold">
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
