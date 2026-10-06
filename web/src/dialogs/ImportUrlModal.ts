/**
 * Code-behind of `ImportUrlModal.kbview` (converted from `ImportUrlModal.tsx` by @kubuno/views-migrate).
 */
import { bind, type EventArgs } from '@kubuno/views'
import { useTranslation } from "react-i18next"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@kubuno/sdk"
import { useFilesStore } from "@kubuno/drive"

import { ViewBase } from './ImportUrlModal.kbview'
import * as __parts from './ImportUrlModal.parts.tsx'

interface ImportUrlDto {
  url:       string
  folder_id: string | null
  name:      string
}

async function importFromUrl(dto: ImportUrlDto) {
  const res = await api.post('/drive/import-url', dto)
  return res.data
}

export class ImportUrlModal extends ViewBase {
  @bind accessor url = ''
  @bind accessor name = ''
  tr!: ImportUrlModalStores['t']
  importUrlOpen!: boolean
  closeImportUrl!: () => void
  currentFolderId!: string | null
  refresh!: () => void
  queryClient!: ImportUrlModalStores['queryClient']
  mutation!: ImportUrlModalHooks['mutation']

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const { t } = useTranslation('drive')
    const { importUrlOpen, closeImportUrl, currentFolderId, refresh } = useFilesStore()
    const queryClient = useQueryClient()
    return { t, importUrlOpen, closeImportUrl, currentFolderId, refresh, queryClient }
  }

  /** The screen's hooks that read its members (run after the fields of `useStores()` are set). React's rules apply: `use()` runs them on every render. */
  useHooks() {
    const refresh = this.refresh
    const queryClient = this.queryClient
    const mutation = useMutation({
      mutationFn: importFromUrl,
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['files'] })
        refresh()
        this.handleClose()
      },
    })
    this.publish({ mutation })
    return { mutation }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ tr: s.t, importUrlOpen: s.importUrlOpen, closeImportUrl: s.closeImportUrl, currentFolderId: s.currentFolderId, refresh: s.refresh, queryClient: s.queryClient })
    const h = this.useHooks()
    this.publish({ mutation: h.mutation })
  }

  get show_case_1() {
    return !!(!this.importUrlOpen)
  }

  get show_main() {
    return !(!this.importUrlOpen)
  }

  get part1_props() {
    return this.memo('part1_props', [this.url, this.memo, this.tr, this.importUrlOpen], () => {
      if (!(!(!this.importUrlOpen))) return undefined as never
      return ({ url: this.url, setUrl: this.memo("setUrl:bound", [], () => this.setUrl.bind(this)), t: this.tr })
    })
  }

  /** A part of the screen still written in React (<TextField> autoFocus: no .kbview property). */
  get Part1() {
    if (!(!(!this.importUrlOpen))) return undefined as never
    return __parts.Part1
  }

  get p_text() {
    if (!(!(!this.importUrlOpen)) || !(this.mutation.isError)) return undefined as never
    return (this.mutation.error as { response?: { data?: { message?: string } } })
                ?.response?.data?.message ?? this.tr('importurl.error_generic')
  }

  get enabled_unless_mutation_is_pending() {
    if (!(!(!this.importUrlOpen))) return undefined as never
    return !(this.mutation.isPending)
  }

  get enabled_unless_url_trim() {
    if (!(!(!this.importUrlOpen))) return undefined as never
    return !(!this.url.trim())
  }

  handleClose() {
    this.url = ''
    this.name = ''
    this.mutation.reset()
    this.closeImportUrl()
  }

  handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = this.url.trim()
    if (!trimmed) return
    this.mutation.mutate({ url: trimmed, folder_id: this.currentFolderId, name: this.name.trim() || '' })
  }

  panel_submit(_sender: unknown, args: EventArgs) {
    return this.handleSubmit(args.native as never)
  }

  /** `setUrl` of the TSX: a value, or an update of the previous one. */
  setUrl(value: ImportUrlModal['url'] | ((prev: ImportUrlModal['url']) => ImportUrlModal['url'])) {
    this.url = typeof value === 'function' ? (value as (prev: ImportUrlModal['url']) => ImportUrlModal['url'])(this.url) : value
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type ImportUrlModalStores = ReturnType<ImportUrlModal['useStores']>

/** What `useHooks()` gives (the types of the fields it fills). */
export type ImportUrlModalHooks = ReturnType<ImportUrlModal['useHooks']>

export default ImportUrlModal.component()
