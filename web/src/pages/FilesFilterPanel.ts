/**
 * Code-behind of `FilesFilterPanel.kbcontrol` (converted from `FilesFilterPanel.tsx` by @kubuno/views-migrate).
 */
import { type EventArgs, type ValueChangedEventArgs } from '@kubuno/views'
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useSearchStore } from "@kubuno/sdk"
import { useFilesStore, type FilesSearchFilters } from "@kubuno/drive"

import { ViewBase } from './FilesFilterPanel.kbcontrol'

const rowClass   = 'flex items-start gap-6'

const labelClass = 'text-sm font-medium text-text-primary w-44 shrink-0 pt-2'

export type FilesFilterPanelProps = { onClose: () => void }

export class FilesFilterPanel extends ViewBase {
  tr!: FilesFilterPanelStores['t']
  searchFilters!: FilesSearchFilters
  setSearchFilters!: (partial: Partial<FilesSearchFilters>) => void
  applySearch!: () => void
  clearSearch!: () => void
  setSearchQuery!: (q: string) => void
  setQuery!: (q: string) => void
  words!: FilesFilterPanelStores['words']
  setWords!: FilesFilterPanelStores['setWords']
  lastBuilt!: FilesFilterPanelStores['lastBuilt']

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const { t } = useTranslation('drive')
    const { searchFilters, setSearchFilters, applySearch, clearSearch, setSearchQuery } = useFilesStore()
    const query    = useSearchStore(s => s.query)
    const setQuery = useSearchStore(s => s.setQuery)
    const [words, setWords] = useState<string>(query)
    const lastBuilt = useRef<string | null>(null)
    useEffect(() => {
      if (query === lastBuilt.current) return
      setWords(query)
    }, [query])
    return { t, searchFilters, setSearchFilters, applySearch, clearSearch, setSearchQuery, query, setQuery, words, setWords, lastBuilt }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ tr: s.t, searchFilters: s.searchFilters, setSearchFilters: s.setSearchFilters, applySearch: s.applySearch, clearSearch: s.clearSearch, setSearchQuery: s.setSearchQuery, setQuery: s.setQuery, words: s.words, setWords: s.setWords, lastBuilt: s.lastBuilt })
  }

  get div_class() {
    return rowClass
  }

  get span_class() {
    return labelClass
  }

  get items_source() {
    return this.memo('items_source', [this.tr], () => [
            { value: 'all',          label: this.tr('filter.t_all') },
            { value: 'folder',       label: this.tr('filter.t_folder') },
            { value: 'document',     label: this.tr('filter.t_document') },
            { value: 'spreadsheet',  label: this.tr('filter.t_spreadsheet') },
            { value: 'presentation', label: this.tr('filter.t_presentation') },
            { value: 'pdf',          label: this.tr('filter.t_pdf') },
            { value: 'image',        label: this.tr('filter.t_image') },
            { value: 'video',        label: this.tr('filter.t_video') },
            { value: 'audio',        label: this.tr('filter.t_audio') },
            { value: 'archive',      label: this.tr('filter.t_archive') },
          ])
  }

  get items_source2() {
    return this.memo('items_source2', [this.tr], () => [
            { value: 'anyone', label: this.tr('filter.o_anyone') },
            { value: 'me',     label: this.tr('filter.o_me') },
            { value: 'notme',  label: this.tr('filter.o_notme') },
          ])
  }

  get items_source3() {
    return this.memo('items_source3', [this.tr], () => [
              { value: 'everywhere', label: this.tr('filter.loc_everywhere') },
              { value: 'mydrive',    label: this.tr('nav.my_files') },
            ])
  }

  get items_source4() {
    return this.memo('items_source4', [this.tr], () => [
            { value: 'anytime',  label: this.tr('filter.d_anytime') },
            { value: 'today',    label: this.tr('filter.d_today') },
            { value: '7days',    label: this.tr('filter.d_7days') },
            { value: '30days',   label: this.tr('filter.d_30days') },
            { value: 'thisyear', label: this.tr('filter.d_thisyear') },
            { value: 'lastyear', label: this.tr('filter.d_lastyear') },
          ])
  }

  setContainsWords(v: string) {
    this.setWords(v)
    this.lastBuilt.current = v
    this.setQuery(v)          // rewrite the bar's text live
    this.setSearchQuery(v)    // run the live search, like typing in the bar does
  }

  handleSearch() { this.applySearch(); this.props.onClose() }

  handleReset() { this.clearSearch(); this.setWords(''); this.lastBuilt.current = ''; this.setQuery(''); this.props.onClose() }

  dropdown_selected_value_changed(_sender: unknown, args: ValueChangedEventArgs) {
    const v = args.value as string
    this.setSearchFilters({ type: v as FilesSearchFilters['type'] })
  }

  dropdown_selected_value_changed2(_sender: unknown, args: ValueChangedEventArgs) {
    const v = args.value as string
    this.setSearchFilters({ owner: v as FilesSearchFilters['owner'] })
  }

  text_field_text_changed(_sender: unknown, args: EventArgs) {
    const e = args.native as React.ChangeEvent<HTMLInputElement, HTMLInputElement>
    this.setContainsWords(e.target.value)
  }

  text_field_text_changed2(_sender: unknown, args: EventArgs) {
    const e = args.native as React.ChangeEvent<HTMLInputElement, HTMLInputElement>
    this.setSearchFilters({ itemName: e.target.value })
  }

  dropdown_selected_value_changed3(_sender: unknown, args: ValueChangedEventArgs) {
    const v = args.value as string
    this.setSearchFilters({ location: v as FilesSearchFilters['location'] })
  }

  check_box_checked_changed(_sender: unknown, args: ValueChangedEventArgs) {
    const v = args.value as boolean
    this.setSearchFilters({ inTrash: v })
  }

  check_box_checked_changed2(_sender: unknown, args: ValueChangedEventArgs) {
    const v = args.value as boolean
    this.setSearchFilters({ isStarred: v })
  }

  dropdown_selected_value_changed4(_sender: unknown, args: ValueChangedEventArgs) {
    const v = args.value as string
    this.setSearchFilters({ modifiedDate: v as FilesSearchFilters['modifiedDate'] })
  }

  text_field_text_changed3(_sender: unknown, args: EventArgs) {
    const e = args.native as React.ChangeEvent<HTMLInputElement, HTMLInputElement>
    this.setSearchFilters({ sharedWith: e.target.value })
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type FilesFilterPanelStores = ReturnType<FilesFilterPanel['useStores']>

export default FilesFilterPanel.component()
