package com.kubuno.android.ui.browse

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.kubuno.android.R
import com.kubuno.android.api.KubunoClient
import com.kubuno.android.sync.DriveActions
import com.kubuno.android.sync.db.FileEntity
import com.kubuno.android.sync.db.FolderEntity
import com.kubuno.android.sync.db.KubunoDatabase
import com.kubuno.android.sync.transfer.TransferQueue
import com.kubuno.android.ui.browser.FileRow
import com.kubuno.android.ui.browser.FolderRow
import com.kubuno.android.ui.browser.ListContainer
import com.kubuno.android.ui.browser.SectionTitle
import com.kubuno.android.ui.browser.TabEmptyState
import com.kubuno.android.ui.sheet.FileInfoSheet
import com.kubuno.android.ui.sheet.ItemActionSheet
import com.kubuno.android.ui.sheet.ItemTarget
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class BrowseList(
    val folders: List<FolderEntity> = emptyList(),
    val files: List<FileEntity> = emptyList(),
) {
    val isEmpty: Boolean get() = folders.isEmpty() && files.isEmpty()
}

/**
 * Backs the drawer's Recent and Trash destinations and the header search.
 *
 * Everything reads Room, so all three keep working offline and answer as fast
 * as the user types — the server's own search endpoint would add a round trip
 * for results we already hold.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class BrowseViewModel @Inject constructor(
    private val db: KubunoDatabase,
    private val client: KubunoClient,
    private val actions: DriveActions,
    private val transfers: TransferQueue,
) : ViewModel() {

    val recent: StateFlow<List<FileEntity>> = db.browseDao().recentFiles()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /** Top-level folders, offered in the drawer as direct jumps. */
    val rootFolders: StateFlow<List<FolderEntity>> = db.browseDao().rootFolders()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val trash: StateFlow<BrowseList> =
        combine(db.browseDao().trashedFolders(), db.browseDao().trashedFiles()) { folders, files ->
            BrowseList(folders, files)
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), BrowseList())

    private val _query = MutableStateFlow("")
    val query: StateFlow<String> = _query

    val results: StateFlow<BrowseList> = _query
        .flatMapLatest { term ->
            // Below two characters the result set is noise, not an answer.
            if (term.trim().length < 2) flowOf(BrowseList())
            else combine(
                db.browseDao().searchFolders(term.trim()),
                db.browseDao().searchFiles(term.trim()),
            ) { folders, files -> BrowseList(folders, files) }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), BrowseList())

    val serverBaseUrl: String? get() = client.serverBaseUrl()

    fun search(term: String) { _query.value = term }

    fun restore(id: String, isFolder: Boolean) =
        viewModelScope.launch { actions.restore(id, isFolder) }

    fun trashItem(id: String, isFolder: Boolean) =
        viewModelScope.launch { actions.trash(id, isFolder) }

    fun download(file: FileEntity) = viewModelScope.launch {
        transfers.enqueueDownload(file.id, file.name, file.size, file.mimeType)
    }
}

@Composable
fun RecentScreen(viewModel: BrowseViewModel) {
    val files by viewModel.recent.collectAsStateWithLifecycle()
    if (files.isEmpty()) {
        TabEmptyState(Icons.Outlined.Schedule, stringResource(R.string.empty_recent))
        return
    }
    SimpleFileList(files, viewModel)
}

@Composable
fun TrashScreen(viewModel: BrowseViewModel, onOpenFolder: (String) -> Unit) {
    val content by viewModel.trash.collectAsStateWithLifecycle()
    var target by remember { mutableStateOf<ItemTarget?>(null) }

    if (content.isEmpty) {
        TabEmptyState(Icons.Outlined.Delete, stringResource(R.string.empty_trash))
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 12.dp),
    ) {
        if (content.folders.isNotEmpty()) {
            item {
                SectionTitle(stringResource(R.string.section_folders))
                ListContainer {
                    content.folders.forEachIndexed { index, folder ->
                        FolderRow(
                            folder = folder,
                            zebra = index % 2 == 0,
                            onOpen = { target = folder.asTarget() },
                            onMenu = { target = folder.asTarget() },
                        )
                    }
                }
            }
        }
        if (content.files.isNotEmpty()) {
            item {
                SectionTitle(stringResource(R.string.section_files))
                ListContainer {
                    content.files.forEachIndexed { index, file ->
                        FileRow(
                            file = file,
                            baseUrl = viewModel.serverBaseUrl,
                            zebra = index % 2 == 0,
                            onOpen = { target = file.asTarget() },
                            onMenu = { target = file.asTarget() },
                        )
                    }
                }
            }
        }
    }

    ItemSheet(target, viewModel, onDismiss = { target = null })
}

@Composable
fun SearchScreen(viewModel: BrowseViewModel, onOpenFolder: (String) -> Unit) {
    val query by viewModel.query.collectAsStateWithLifecycle()
    val content by viewModel.results.collectAsStateWithLifecycle()
    var target by remember { mutableStateOf<ItemTarget?>(null) }

    if (content.isEmpty) {
        TabEmptyState(
            Icons.Outlined.SearchOff,
            stringResource(
                if (query.trim().length < 2) R.string.search_prompt else R.string.search_no_results
            ),
        )
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 12.dp),
    ) {
        if (content.folders.isNotEmpty()) {
            item {
                SectionTitle(stringResource(R.string.section_folders))
                ListContainer {
                    content.folders.forEachIndexed { index, folder ->
                        FolderRow(
                            folder = folder,
                            zebra = index % 2 == 0,
                            onOpen = { onOpenFolder(folder.id) },
                            onMenu = { target = folder.asTarget() },
                        )
                    }
                }
            }
        }
        if (content.files.isNotEmpty()) {
            item {
                SectionTitle(stringResource(R.string.section_files))
                ListContainer {
                    content.files.forEachIndexed { index, file ->
                        FileRow(
                            file = file,
                            baseUrl = viewModel.serverBaseUrl,
                            zebra = index % 2 == 0,
                            onOpen = { target = file.asTarget() },
                            onMenu = { target = file.asTarget() },
                        )
                    }
                }
            }
        }
    }

    ItemSheet(target, viewModel, onDismiss = { target = null })
}

@Composable
private fun SimpleFileList(files: List<FileEntity>, viewModel: BrowseViewModel) {
    var target by remember { mutableStateOf<ItemTarget?>(null) }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 12.dp),
    ) {
        item {
            ListContainer {
                files.forEachIndexed { index, file ->
                    FileRow(
                        file = file,
                        baseUrl = viewModel.serverBaseUrl,
                        zebra = index % 2 == 0,
                        onOpen = { target = file.asTarget() },
                        onMenu = { target = file.asTarget() },
                    )
                }
            }
        }
    }
    ItemSheet(target, viewModel, onDismiss = { target = null })
}

@Composable
private fun ItemSheet(target: ItemTarget?, viewModel: BrowseViewModel, onDismiss: () -> Unit) {
    var info by remember { mutableStateOf<FileEntity?>(null) }
    target?.let {
        ItemActionSheet(
            target = it,
            onDownload = { viewModel.recent.value.firstOrNull { f -> f.id == it.id }?.let(viewModel::download) },
            // Renaming and moving belong to the browser, which owns the folder
            // context these lists do not carry.
            onRename = {},
            onMove = {},
            onToggleStar = {},
            onTogglePin = {},
            onInfo = {},
            onTrash = { viewModel.trashItem(it.id, it.isFolder) },
            onRestore = { viewModel.restore(it.id, it.isFolder) },
            onDismiss = onDismiss,
        )
    }
    info?.let { FileInfoSheet(file = it, onDismiss = { info = null }) }
}

private fun FileEntity.asTarget() =
    ItemTarget(id = id, name = name, isFolder = false, starred = starred, trashed = trashed)

private fun FolderEntity.asTarget() =
    ItemTarget(id = id, name = name, isFolder = true, starred = starred, trashed = trashed)
