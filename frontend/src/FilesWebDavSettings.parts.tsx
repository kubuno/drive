/**
 * The parts of `FilesWebDavSettings.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Copy, RefreshCw, Check, ExternalLink } from "lucide-react"
import { Button } from "@ui"
import type { FilesWebDavSettings } from './FilesWebDavSettings'

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
export { CopyButton }

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
export { ConnectRow }

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
export { Instruction }

export function Part1({ regenMut, t }: { regenMut: NonNullable<FilesWebDavSettings['regenMut']>; t: NonNullable<FilesWebDavSettings['tr']> }) {
  return (
    <Button
                    size="sm"
                    variant="secondary"
                    icon={<RefreshCw size={13} className={regenMut.isPending ? 'animate-spin' : ''} />}
                    onClick={() => regenMut.mutate()}
                    loading={regenMut.isPending}
                  >
                    {t('webdav.regen')}
                  </Button>
  )
}
