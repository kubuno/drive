/**
 * RemoteExplorer — route `/drive/remote/:id`. Rend la MÊME zone d'exploration que
 * « Mon Drive » (`StorageExplorer`), branchée sur la source distante du montage.
 * Toute la personnalisation (fonctions masquées) vient des capacités de la source.
 */
import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { StorageExplorer, filesApi, remoteSource } from '@kubuno/drive'

export default function RemoteExplorer() {
  const { id = '' } = useParams<{ id: string }>()
  const { data: remotes } = useQuery({ queryKey: ['remotes'], queryFn: filesApi.listRemotes })
  const remote = remotes?.find(r => r.id === id)
  const name = remote?.name ?? remote?.mount_name ?? 'Stockage distant'
  const source = useMemo(() => remoteSource(id, name), [id, name])
  return <StorageExplorer source={source} title={name} pathParam="path" />
}
