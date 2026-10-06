// Renders a storage mount published by another active module (via
// ModuleServiceRegistry) inside the shared Drive explorer. Generic: any module
// that publishes `getStorageMounts()` + `getStorageSource(key)` shows up here.
import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { StorageExplorer } from '@kubuno/drive'
import { ModuleServiceRegistry } from '@kubuno/sdk'

export default function ModuleMountExplorer() {
  const { moduleId = '', mountKey = '' } = useParams<{ moduleId: string; mountKey: string }>()

  // Recreate the source only when the mount changes (its `key` namespaces the cache).
  const source = useMemo(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => ModuleServiceRegistry.call<any>(moduleId, 'getStorageSource', mountKey),
    [moduleId, mountKey],
  )
  const mounts = ModuleServiceRegistry.call<Array<{ key: string; name: string }>>(moduleId, 'getStorageMounts') ?? []
  const name = mounts.find(m => m.key === mountKey)?.name ?? 'Montage'

  if (!source) {
    return <div className="p-8 text-sm text-text-tertiary">Ce montage n’est pas disponible (module inactif).</div>
  }
  return <StorageExplorer source={source} title={name} pathParam="path" />
}
