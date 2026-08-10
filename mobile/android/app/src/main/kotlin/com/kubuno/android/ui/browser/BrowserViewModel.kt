package com.kubuno.android.ui.browser

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.kubuno.android.account.AccountGraph
import com.kubuno.android.account.ActiveAccount
import com.kubuno.android.sync.db.FileEntity
import com.kubuno.android.sync.db.FolderEntity
import com.kubuno.android.sync.work.SyncScheduler
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class BrowserContent(
    val folders: List<FolderEntity> = emptyList(),
    val files: List<FileEntity> = emptyList(),
) {
    val isEmpty: Boolean get() = folders.isEmpty() && files.isEmpty()
}

/**
 * Reads whichever account is on screen.
 *
 * Everything derives from [ActiveAccount.graph]: switching account re-points
 * the queries at another database and another server without recreating the
 * screen, and no query here can reach a different account's data.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class BrowserViewModel @Inject constructor(
    private val active: ActiveAccount,
    workManager: WorkManager,
) : ViewModel() {

    private val graph: StateFlow<AccountGraph?> = active.graph

    val userLabel: String? get() = active.record?.label
    val userEmail: String? get() = active.record?.email
    val avatarUrl: String? get() = active.record?.let { it.absolute(it.avatarPath) }
    val serverBaseUrl: String? get() = active.record?.serverUrl

    val pinnedIds: StateFlow<Set<String>> = graph
        .flatMapLatest { g -> g?.db?.pinDao()?.all() ?: flowOf(emptyList()) }
        .map { pins -> pins.map { it.fileId }.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    /** The open folder, null at the drive root. */
    private val _folderId = MutableStateFlow<String?>(null)
    val folderId: StateFlow<String?> = _folderId

    private val _sortField = MutableStateFlow(SortField.DATE)
    val sortField: StateFlow<SortField> = _sortField

    private val _sortDir = MutableStateFlow(SortDir.DESC)
    val sortDir: StateFlow<SortDir> = _sortDir

    // The web defaults the phone explorer to grid.
    private val _view = MutableStateFlow(ViewMode.GRID)
    val view: StateFlow<ViewMode> = _view

    val content: StateFlow<BrowserContent> =
        combine(graph, _folderId, _sortField, _sortDir, ::Selection)
            .flatMapLatest { (g, id, field, dir) ->
                if (g == null) flowOf(BrowserContent())
                else combine(
                    g.db.folderDao().children(id),
                    g.db.fileDao().filesIn(id),
                ) { folders, files ->
                    BrowserContent(sortFolders(folders, field, dir), sortFiles(files, field, dir))
                }
            }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), BrowserContent())

    val refreshing: StateFlow<Boolean> = graph
        .flatMapLatest { g ->
            if (g == null) flowOf(emptyList())
            else workManager.getWorkInfosForUniqueWorkFlow(SyncScheduler.workName(g.id))
        }
        .map { infos -> infos.any { it.state == WorkInfo.State.RUNNING } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    fun openFolder(id: String?) { _folderId.value = id }
    fun setSort(field: SortField) { _sortField.value = field }
    fun toggleSortDir() {
        _sortDir.value = if (_sortDir.value == SortDir.ASC) SortDir.DESC else SortDir.ASC
    }
    fun setView(mode: ViewMode) { _view.value = mode }

    fun refresh() { graph.value?.scheduler?.syncNow() }

    // ---- mutations: local first, replayed from the outbox ----------------

    private fun withGraph(block: suspend (AccountGraph) -> Unit) {
        val g = graph.value ?: return
        viewModelScope.launch { block(g) }
    }

    fun rename(id: String, isFolder: Boolean, newName: String) =
        withGraph { it.actions.rename(id, isFolder, newName) }

    fun move(id: String, isFolder: Boolean, target: String?) =
        withGraph { it.actions.move(id, isFolder, target) }

    fun trash(id: String, isFolder: Boolean) = withGraph { it.actions.trash(id, isFolder) }

    fun restore(id: String, isFolder: Boolean) = withGraph { it.actions.restore(id, isFolder) }

    fun setStarred(id: String, isFolder: Boolean, starred: Boolean) =
        withGraph { it.actions.setStarred(id, isFolder, starred) }

    fun createFolder(name: String) = withGraph { it.actions.createFolder(_folderId.value, name) }

    fun upload(uris: List<Uri>) =
        withGraph { g -> uris.forEach { g.transfers.enqueueUpload(it, _folderId.value) } }

    fun download(file: FileEntity) =
        withGraph { it.transfers.enqueueDownload(file.id, file.name, file.size, file.mimeType) }

    /** Downloads (or reuses the pinned copy of) a file for the in-app viewer. */
    suspend fun fetchForViewer(fileId: String): java.io.File {
        val g = graph.value ?: error("Aucun compte")
        return g.offline.cacheForViewing(fileId)
    }

    fun togglePin(fileId: String, pinned: Boolean) = withGraph {
        if (pinned) it.offline.unpin(fileId) else it.offline.pin(fileId)
    }

    /** Drops local copies but keeps the pins, so they refill on the next sync. */
    fun purgeOffline() = withGraph { it.offline.purge() }
}

/** What the listing depends on; combine() has no four-arg destructuring form. */
private data class Selection(
    val graph: AccountGraph?,
    val folderId: String?,
    val field: SortField,
    val dir: SortDir,
)

private fun sortFolders(
    folders: List<FolderEntity>,
    field: SortField,
    dir: SortDir,
): List<FolderEntity> {
    // Folders carry neither size nor type, so those criteria fall back to name.
    val sorted = when (field) {
        SortField.DATE -> folders.sortedBy { it.updatedAt.orEmpty() }
        else -> folders.sortedBy { it.name.lowercase() }
    }
    return if (dir == SortDir.DESC) sorted.reversed() else sorted
}

private fun sortFiles(files: List<FileEntity>, field: SortField, dir: SortDir): List<FileEntity> {
    val sorted = when (field) {
        SortField.NAME -> files.sortedBy { it.name.lowercase() }
        SortField.DATE -> files.sortedBy { it.updatedAt.orEmpty() }
        SortField.SIZE -> files.sortedBy { it.size }
        SortField.TYPE -> files.sortedWith(
            compareBy({ it.mimeType.orEmpty() }, { it.name.lowercase() })
        )
    }
    return if (dir == SortDir.DESC) sorted.reversed() else sorted
}
