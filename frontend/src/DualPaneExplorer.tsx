/**
 * DualPaneExplorer — vue « double-volet » de Drive (façon gestionnaire de fichiers).
 * Deux `StorageExplorer` côte à côte, chacun branché sur la source de son choix
 * (Mon Drive ou n'importe quel montage distant). Transferts dans les deux sens, y
 * compris par glisser-déposer inter-volets (délégué à `transferItem`).
 * Séparateur redimensionnable + orientation horizontale/verticale.
 */
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Columns2, Rows2 } from 'lucide-react'
import { Dropdown } from '@ui'
import { useNotificationStore } from '@kubuno/sdk'
import {
  StorageExplorer, filesApi, localSource, remoteSource, transferItem,
  type StorageSource, type ExternalDragItem,
} from '@kubuno/drive'

interface SourceOpt { key: string; label: string; make: () => StorageSource }

function Pane({ source, label, options, onPick, onExternalDrop }: {
  source: StorageSource; label: string; options: SourceOpt[]
  onPick: (key: string) => void
  onExternalDrop: (payload: ExternalDragItem, targetParentId: string | null) => void
}) {
  return (
    <div className="flex flex-col min-h-0 min-w-0 flex-1 bg-white">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-surface-1 shrink-0">
        <Dropdown variant="ghost" value={source.key} onChange={onPick} options={options.map(o => ({ value: o.key, label: o.label }))} />
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        <StorageExplorer key={source.key} source={source} title={label} onExternalDrop={onExternalDrop} />
      </div>
    </div>
  )
}

export default function DualPaneExplorer() {
  const { t } = useTranslation('drive')
  const qc = useQueryClient()
  const notify = useNotificationStore(s => s.push)
  const { data: remotes } = useQuery({ queryKey: ['remotes'], queryFn: filesApi.listRemotes })

  const options: SourceOpt[] = useMemo(() => [
    { key: 'local', label: t('nav.my_drive', { defaultValue: 'Mon Drive' }), make: () => localSource() },
    ...(remotes ?? []).map(r => ({ key: `remote:${r.id}`, label: r.name ?? r.mount_name, make: () => remoteSource(r.id, r.name ?? r.mount_name) })),
  ], [remotes, t])

  const [leftKey, setLeftKey] = useState('local')
  const [rightKey, setRightKey] = useState('local')
  const leftSource = useMemo(() => (options.find(o => o.key === leftKey) ?? options[0]).make(), [options, leftKey])
  const rightSource = useMemo(() => (options.find(o => o.key === rightKey) ?? options[0]).make(), [options, rightKey])
  const leftLabel = options.find(o => o.key === leftKey)?.label ?? 'Mon Drive'
  const rightLabel = options.find(o => o.key === rightKey)?.label ?? 'Mon Drive'

  // Quand le second volet est encore sur 'local' par défaut, proposer le 1er montage.
  if (rightKey === 'local' && leftKey === 'local' && (remotes?.length ?? 0) > 0) {
    setRightKey(`remote:${remotes![0].id}`)
  }

  const transfer = (from: StorageSource, to: StorageSource, payload: ExternalDragItem, targetParentId: string | null) => {
    transferItem(from, to, { id: payload.id, type: payload.type, name: payload.name }, targetParentId, 'copy')
      .then(() => {
        qc.invalidateQueries({ queryKey: ['explorer', to.key] })
        qc.invalidateQueries({ queryKey: ['explorer', from.key] })
        notify?.({ title: t('nav.my_drive', { defaultValue: 'Drive' }), body: t('dual.transferred', { defaultValue: `« ${payload.name} » transféré`, name: payload.name }), moduleId: 'drive' })
      })
      .catch(() => notify?.({ title: 'Drive', body: t('dual.transfer_failed', { defaultValue: 'Échec du transfert' }), moduleId: 'drive' }))
  }
  const fromOf = (key: string) => (leftSource.key === key ? leftSource : rightSource)

  const [orient, setOrient] = useState<'h' | 'v'>('h')
  const [ratio, setRatio] = useState(0.5)
  const containerRef = useRef<HTMLDivElement>(null)
  const onDividerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const move = (ev: PointerEvent) => {
      const r = orient === 'h' ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height
      setRatio(Math.min(0.85, Math.max(0.15, r)))
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
        <span className="text-sm font-medium text-text-primary">{t('dual.title', { defaultValue: 'Deux volets' })}</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setOrient('h')} title={t('dual.horizontal', { defaultValue: 'Côte à côte' })}
            className={`p-1.5 rounded-md transition-colors ${orient === 'h' ? 'bg-primary-light text-primary' : 'text-text-secondary hover:bg-surface-2'}`}><Columns2 size={16} /></button>
          <button onClick={() => setOrient('v')} title={t('dual.vertical', { defaultValue: 'Empilé' })}
            className={`p-1.5 rounded-md transition-colors ${orient === 'v' ? 'bg-primary-light text-primary' : 'text-text-secondary hover:bg-surface-2'}`}><Rows2 size={16} /></button>
        </div>
      </div>

      <div ref={containerRef} className={`flex-1 min-h-0 min-w-0 flex ${orient === 'h' ? 'flex-row' : 'flex-col'}`}>
        <div style={{ flexBasis: `${ratio * 100}%` }} className="min-w-0 min-h-0 flex">
          <Pane source={leftSource} label={leftLabel} options={options} onPick={setLeftKey}
            onExternalDrop={(payload, target) => transfer(fromOf(payload.sourceKey), leftSource, payload, target)} />
        </div>
        <div onPointerDown={onDividerDown}
          className={`shrink-0 bg-border hover:bg-primary/40 transition-colors ${orient === 'h' ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize'}`} />
        <div style={{ flexBasis: `${(1 - ratio) * 100}%` }} className="min-w-0 min-h-0 flex">
          <Pane source={rightSource} label={rightLabel} options={options} onPick={setRightKey}
            onExternalDrop={(payload, target) => transfer(fromOf(payload.sourceKey), rightSource, payload, target)} />
        </div>
      </div>
    </div>
  )
}
