package com.kubuno.android.ui.browser

import androidx.lifecycle.SavedStateHandle
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
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@HiltViewModel
class BrowserViewModel @Inject constructor(
    savedState: SavedStateHandle,
    db: KubunoDatabase,
    workManager: WorkManager,
    private val scheduler: SyncScheduler,
    private val client: KubunoClient,
) : ViewModel() {

    /** Null = drive root. */
    val folderId: String? = savedState.get<String>("folderId")

    val folders: Flow<List<FolderEntity>> = db.folderDao().children(folderId)
    val files: Flow<List<FileEntity>> = db.fileDao().filesIn(folderId)

    /** Current folder's name for the top bar (null at root). */
    val folderName: StateFlow<String?> =
        (folderId?.let { id -> db.folderDao().byId(id).map { it?.name } }
            ?: kotlinx.coroutines.flow.flowOf(null))
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Pull-to-refresh spinner driven by the actual unique work state. */
    val refreshing: StateFlow<Boolean> =
        workManager.getWorkInfosForUniqueWorkFlow("drive-sync")
            .map { infos -> infos.any { it.state == WorkInfo.State.RUNNING } }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    val serverBaseUrl: String? get() = client.serverBaseUrl()

    fun refresh() = scheduler.syncNow()

    fun logout(onDone: () -> Unit) {
        viewModelScope.launch {
            client.tokenManager.logout()
            onDone()
        }
    }
}
