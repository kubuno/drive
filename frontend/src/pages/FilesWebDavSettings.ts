/**
 * Code-behind of `FilesWebDavSettings.kbcontrol` (converted from `FilesWebDavSettings.tsx` by @kubuno/views-migrate).
 */
import { useTranslation } from "react-i18next"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useAuthStore } from "@kubuno/sdk"
import { api } from "@kubuno/sdk"

import { ViewBase } from './FilesWebDavSettings.kbcontrol'
import * as __parts from './FilesWebDavSettings.parts.tsx'

async function fetchWebDavToken(): Promise<string> {
  const { data } = await api.get<{ token: string }>('/drive/webdav-token')
  return data.token
}

async function regenerateWebDavToken(): Promise<string> {
  const { data } = await api.post<{ token: string }>('/drive/webdav-token/regenerate')
  return data.token
}

export class FilesWebDavSettings extends ViewBase {
  tr!: FilesWebDavSettingsStores['t']
  user!: FilesWebDavSettingsStores['user']
  token!: string | undefined
  isLoading!: boolean
  regenMut!: FilesWebDavSettingsStores['regenMut']

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
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
    return { t, user, qc, token, isLoading, regenMut }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ tr: s.t, user: s.user, token: s.token, isLoading: s.isLoading, regenMut: s.regenMut })
  }

  get baseUrl(): string {
    return window.location.origin
  }

  get webdavUrl(): string {
    return `${this.baseUrl}/api/v1/drive/webdav/`
  }

  get username(): string {
    return this.user?.email ?? ''
  }

  get show_not_is_loading() {
    return !(this.isLoading)
  }

  /** `<ConnectRow>`, rendered by a ReactHost. */
  get ConnectRow() {
    if (!(!(this.isLoading))) return undefined as never
    return __parts.ConnectRow
  }

  get connect_row_props() {
    return this.memo('connect_row_props', [this.tr, this.webdavUrl, this.isLoading], () => {
      if (!(!(this.isLoading))) return undefined as never
      return ({ label: this.tr('webdav.url'), value: this.webdavUrl })
    })
  }

  get connect_row_props2() {
    return this.memo('connect_row_props2', [this.tr, this.username, this.isLoading], () => {
      if (!(!(this.isLoading))) return undefined as never
      return ({ label: this.tr('webdav.user'), value: this.username })
    })
  }

  get connect_row_props3() {
    return this.memo('connect_row_props3', [this.tr, this.token, this.isLoading], () => {
      if (!(!(this.isLoading))) return undefined as never
      return ({ label: this.tr('webdav.pwd'), value: this.token ?? '' })
    })
  }

  get part1_props() {
    return this.memo('part1_props', [this.regenMut, this.tr, this.isLoading], () => {
      if (!(!(this.isLoading))) return undefined as never
      return ({ regenMut: this.regenMut, t: this.tr })
    })
  }

  /** A part of the screen still written in React (<Button Icon>: an icon with classes). */
  get Part1() {
    if (!(!(this.isLoading))) return undefined as never
    return __parts.Part1
  }

  /** `<Instruction>`, rendered by a ReactHost. */
  get Instruction() {
    if (!(!(this.isLoading))) return undefined as never
    return __parts.Instruction
  }

  get instruction_props() {
    return this.memo('instruction_props', [this.tr, this.webdavUrl, this.isLoading], () => {
      if (!(!(this.isLoading))) return undefined as never
      return ({ title: "macOS (Finder)", steps: [
                  this.tr('webdav.mac_1'),
                  this.tr('webdav.step_enter_url', { url: this.webdavUrl }),
                  this.tr('webdav.mac_3'),
                  this.tr('webdav.step_enter_creds'),
                ] })
    })
  }

  get instruction_props2() {
    return this.memo('instruction_props2', [this.tr, this.webdavUrl, this.isLoading], () => {
      if (!(!(this.isLoading))) return undefined as never
      return ({ title: "Windows (Explorateur de fichiers)", steps: [
                  this.tr('webdav.win_1'),
                  this.tr('webdav.win_2'),
                  this.tr('webdav.step_enter_url', { url: this.webdavUrl }),
                  this.tr('webdav.step_enter_creds'),
                ] })
    })
  }

  get instruction_props3() {
    return this.memo('instruction_props3', [this.tr, this.isLoading], () => {
      if (!(!(this.isLoading))) return undefined as never
      return ({ title: "Linux (Nautilus / Thunar)", steps: [
                  this.tr('webdav.linux_1'),
                  this.tr('webdav.linux_2', { host: window.location.host }),
                  this.tr('webdav.step_enter_creds'),
                ] })
    })
  }

  get instruction_props4() {
    return this.memo('instruction_props4', [this.tr, this.isLoading], () => {
      if (!(!(this.isLoading))) return undefined as never
      return ({ title: this.tr('webdav.third_title'), steps: [
                  this.tr('webdav.third_proto'),
                  this.tr('webdav.third_server', { host: window.location.host }),
                  this.tr('webdav.third_path'),
                  this.tr('webdav.third_user'),
                  this.tr('webdav.third_pwd'),
                ] })
    })
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type FilesWebDavSettingsStores = ReturnType<FilesWebDavSettings['useStores']>

export default FilesWebDavSettings.component()
