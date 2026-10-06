/**
 * Code-behind of `DialogTree.kbcontrol` (converted from `DialogTree.tsx` by @kubuno/views-migrate).
 */

import { ViewBase } from './DialogTree.kbcontrol'
import * as __parts from './DialogTree.parts.tsx'

interface Props {
  /** null = local Drive ; otherwise a remote mount id. */
  sourceId:           string | null
  rootLabel:          string
  /** Highlight: current local folder (null = root). */
  selectedFolderId:   string | null
  /** Highlight: current remote path ('' = root). */
  selectedRemotePath: string
  onPickLocal:        (folderId: string | null) => void
  onPickRemote:       (path: string) => void
}

export type { Props }

export class DialogTree extends ViewBase {
  get show_source_id() {
    return this.props.sourceId === null
  }

  get show_not_source_id() {
    return !(this.props.sourceId === null)
  }

  /** `<LocalTree>`, rendered by a ReactHost. */
  get LocalTree() {
    if (!(this.props.sourceId === null)) return undefined as never
    return __parts.LocalTree
  }

  get local_tree_props() {
    return this.memo('local_tree_props', [this.props], () => {
      if (!(this.props.sourceId === null)) return undefined as never
      return ({ rootLabel: this.props.rootLabel, selectedFolderId: this.props.selectedFolderId, onPick: this.props.onPickLocal })
    })
  }

  /** `<RemoteTree>`, rendered by a ReactHost. */
  get RemoteTree() {
    if (!(!(this.props.sourceId === null))) return undefined as never
    return __parts.RemoteTree
  }

  get remote_tree_props() {
    return this.memo('remote_tree_props', [this.props], () => {
      if (!(!(this.props.sourceId === null))) return undefined as never
      return ({ mountId: this.props.sourceId, rootLabel: this.props.rootLabel, selectedRemotePath: this.props.selectedRemotePath, onPick: this.props.onPickRemote })
    })
  }

}

export default DialogTree.component()
