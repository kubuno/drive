package com.kubuno.android.ui.browser

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.kubuno.android.api.KubunoClient
import com.kubuno.android.sync.db.FileEntity
import com.kubuno.android.sync.db.FolderEntity
import com.kubuno.android.sync.db.KubunoDatabase
import com.kubuno.android.sync.work.SyncScheduler
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class BrowserContent(
    val folders: List<FolderEntity> = emptyList(),
    val files: List<FileEntity> = emptyList(),
) {
    val isEmpty: Boolean get() = folders.isEmpty() && files.isEmpty()
}

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class BrowserViewModel @Inject constructor(
    private val db: KubunoDatabase,
    workManager: WorkManager,
    private val scheduler: SyncScheduler,
    private val client: KubunoClient,
) : ViewModel() {

    /**
     * The open folder, null at the drive root. Driven by the shell's crumb stack
     * rather than a nav argument, so one ViewModel serves every level and the
     * sort/view choice survives navigation.
     */
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
        _folderId.flatMapLatest { id ->
            combine(
                db.folderDao().children(id),
                db.fileDao().filesIn(id),
                _sortField,
                _sortDir,
            ) { folders, files, field, dir ->
                BrowserContent(sortFolders(folders, field, dir), sortFiles(files, field, dir))
            }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), BrowserContent())

    val refreshing: StateFlow<Boolean> =
        workManager.getWorkInfosForUniqueWorkFlow("drive-sync")
            .map { infos -> infos.any { it.state == WorkInfo.State.RUNNING } }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    val serverBaseUrl: String? get() = client.serverBaseUrl()

    fun openFolder(id: String?) {
        _folderId.value = id
    }

    fun setSort(field: SortField) {
        _sortField.value = field
    }

    fun toggleSortDir() {
        _sortDir.value = if (_sortDir.value == SortDir.ASC) SortDir.DESC else SortDir.ASC
    }

    fun setView(mode: ViewMode) {
        _view.value = mode
    }

    fun refresh() = scheduler.syncNow()

    fun logout(onDone: () -> Unit) {
        viewModelScope.launch {
            client.tokenManager.logout()
            onDone()
        }
    }
}

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
