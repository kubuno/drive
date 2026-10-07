package com.kubuno.android.ui.starred

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Star
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
import com.kubuno.android.account.AccountGraph
import com.kubuno.android.account.ActiveAccount
import com.kubuno.android.sync.db.FileEntity
import com.kubuno.android.ui.browser.FileRow
import com.kubuno.android.ui.browser.ListContainer
import com.kubuno.android.ui.browser.TabEmptyState
import com.kubuno.android.ui.sheet.FileInfoSheet
import com.kubuno.android.ui.sheet.ItemActionSheet
import com.kubuno.android.ui.sheet.ItemTarget
import com.kubuno.android.ui.sheet.RenameDialog
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Reads the starred files of whichever account is on screen; switching account
 * re-points the queries without recreating the screen.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class StarredViewModel @Inject constructor(
    private val active: ActiveAccount,
) : ViewModel() {

    private val graph: StateFlow<AccountGraph?> = active.graph

    val files: StateFlow<List<FileEntity>> = graph
        .flatMapLatest { g -> g?.db?.fileDao()?.starred() ?: flowOf(emptyList()) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val pinnedIds: StateFlow<Set<String>> = graph
        .flatMapLatest { g -> g?.db?.pinDao()?.all() ?: flowOf(emptyList()) }
        .map { pins -> pins.map { it.fileId }.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    val serverBaseUrl: String? get() = active.record?.serverUrl

    private fun withGraph(block: suspend (AccountGraph) -> Unit) {
        val g = graph.value ?: return
        viewModelScope.launch { block(g) }
    }

    fun togglePin(fileId: String, pinned: Boolean) = withGraph {
        if (pinned) it.offline.unpin(fileId) else it.offline.pin(fileId)
    }

    fun rename(id: String, newName: String) =
        withGraph { it.actions.rename(id, isFolder = false, newName = newName) }

    fun unstar(id: String) =
        withGraph { it.actions.setStarred(id, isFolder = false, starred = false) }

    fun trash(id: String) = withGraph { it.actions.trash(id, isFolder = false) }

    fun download(file: FileEntity) =
        withGraph { it.transfers.enqueueDownload(file.id, file.name, file.size, file.mimeType) }
}

/** Starred files come straight from the local store, so this tab works offline. */
@Composable
fun StarredScreen(viewModel: StarredViewModel) {
    val files by viewModel.files.collectAsStateWithLifecycle()
    val pinnedIds by viewModel.pinnedIds.collectAsStateWithLifecycle()
    var actionTarget by remember { mutableStateOf<ItemTarget?>(null) }
    var infoTarget by remember { mutableStateOf<FileEntity?>(null) }
    var renameTarget by remember { mutableStateOf<ItemTarget?>(null) }

    if (files.isEmpty()) {
        TabEmptyState(
            icon = Icons.Outlined.Star,
            message = stringResource(R.string.empty_starred),
            hint = stringResource(R.string.empty_starred_hint),
        )
        return
    }

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
                        pinned = file.id in pinnedIds,
                        onOpen = { actionTarget = file.asTarget(pinnedIds) },
                        onMenu = { actionTarget = file.asTarget(pinnedIds) },
                    )
                }
            }
        }
    }

    actionTarget?.let { target ->
        ItemActionSheet(
            target = target,
            onDownload = { files.firstOrNull { it.id == target.id }?.let(viewModel::download) },
            onRename = { renameTarget = target },
            // Moving needs a folder picker the starred view does not carry.
            onMove = {},
            onToggleStar = { viewModel.unstar(target.id) },
            onTogglePin = { viewModel.togglePin(target.id, target.pinned) },
            onInfo = { infoTarget = files.firstOrNull { it.id == target.id } },
            onTrash = { viewModel.trash(target.id) },
            onRestore = {},
            onDismiss = { actionTarget = null },
        )
    }

    renameTarget?.let { target ->
        RenameDialog(
            current = target.name,
            onConfirm = { viewModel.rename(target.id, it); renameTarget = null },
            onDismiss = { renameTarget = null },
        )
    }

    infoTarget?.let { FileInfoSheet(file = it, onDismiss = { infoTarget = null }) }
}

private fun FileEntity.asTarget(pinned: Set<String>) = ItemTarget(
    id = id, name = name, isFolder = false,
    starred = starred, trashed = trashed, pinned = id in pinned,
)
