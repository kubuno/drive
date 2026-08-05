package com.kubuno.android.ui.browser

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kubuno.android.R
import com.kubuno.android.sync.db.FileEntity
import com.kubuno.android.sync.db.FolderEntity
import com.kubuno.android.ui.sheet.FileInfoSheet
import com.kubuno.android.ui.sheet.FolderInfoSheet
import com.kubuno.android.ui.sheet.ItemActionSheet
import com.kubuno.android.ui.sheet.ItemTarget
import com.kubuno.android.ui.sheet.MoveSheet
import com.kubuno.android.ui.sheet.RenameDialog
import com.kubuno.android.ui.sheet.SortSheet
import com.kubuno.android.ui.theme.KubunoTheme

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BrowserScreen(
    viewModel: BrowserViewModel,
    onOpenFolder: (String) -> Unit,
) {
    val content by viewModel.content.collectAsStateWithLifecycle()
    val sortField by viewModel.sortField.collectAsStateWithLifecycle()
    val sortDir by viewModel.sortDir.collectAsStateWithLifecycle()
    val view by viewModel.view.collectAsStateWithLifecycle()
    val refreshing by viewModel.refreshing.collectAsStateWithLifecycle()

    var sortSheet by remember { mutableStateOf(false) }
    var fileSheet by remember { mutableStateOf<FileEntity?>(null) }
    var folderSheet by remember { mutableStateOf<FolderEntity?>(null) }
    var actionTarget by remember { mutableStateOf<ItemTarget?>(null) }
    var renameTarget by remember { mutableStateOf<ItemTarget?>(null) }
    var moveTarget by remember { mutableStateOf<ItemTarget?>(null) }

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = viewModel::refresh,
        modifier = Modifier.fillMaxSize(),
    ) {
        if (content.isEmpty) {
            EmptyFolder()
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 24.dp, end = 24.dp, bottom = 24.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item(span = { GridItemSpan(2) }) {
                    MobileControlBar(
                        sortField = sortField,
                        sortDir = sortDir,
                        view = view,
                        onSortClick = { sortSheet = true },
                        onToggleDir = viewModel::toggleSortDir,
                        onView = viewModel::setView,
                    )
                }

                if (content.folders.isNotEmpty()) {
                    item(span = { GridItemSpan(2) }) {
                        SectionTitle(stringResource(R.string.section_folders))
                    }
                }

                when (view) {
                    ViewMode.GRID -> {
                        // Folder chips stay full width: two columns would truncate names.
                        items(content.folders, key = { "d:${it.id}" }, span = { GridItemSpan(2) }) { folder ->
                            FolderCard(
                                folder = folder,
                                onOpen = { onOpenFolder(folder.id) },
                                onMenu = { actionTarget = folder.asTarget() },
                            )
                        }
                        if (content.files.isNotEmpty()) {
                            item(span = { GridItemSpan(2) }) {
                                Spacer(Modifier.height(4.dp))
                                SectionTitle(stringResource(R.string.section_files))
                            }
                        }
                        items(content.files, key = { "f:${it.id}" }) { file ->
                            FileCard(
                                file = file,
                                baseUrl = viewModel.serverBaseUrl,
                                onOpen = { actionTarget = file.asTarget() },
                                onMenu = { actionTarget = file.asTarget() },
                            )
                        }
                    }

                    ViewMode.LIST -> {
                        item(span = { GridItemSpan(2) }) {
                            ListContainer {
                                content.folders.forEachIndexed { index, folder ->
                                    FolderRow(
                                        folder = folder,
                                        zebra = index % 2 == 0,
                                        onOpen = { onOpenFolder(folder.id) },
                                        onMenu = { actionTarget = folder.asTarget() },
                                    )
                                }
                            }
                        }
                        if (content.files.isNotEmpty()) {
                            item(span = { GridItemSpan(2) }) {
                                Spacer(Modifier.height(4.dp))
                                SectionTitle(stringResource(R.string.section_files))
                                ListContainer {
                                    content.files.forEachIndexed { index, file ->
                                        FileRow(
                                            file = file,
                                            baseUrl = viewModel.serverBaseUrl,
                                            zebra = index % 2 == 0,
                                            onOpen = { actionTarget = file.asTarget() },
                                            onMenu = { actionTarget = file.asTarget() },
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (sortSheet) {
        SortSheet(
            field = sortField,
            dir = sortDir,
            onField = { viewModel.setSort(it) },
            onDir = { if (it != sortDir) viewModel.toggleSortDir() },
            onDismiss = { sortSheet = false },
        )
    }

    actionTarget?.let { target ->
        ItemActionSheet(
            target = target,
            onDownload = {
                content.files.firstOrNull { it.id == target.id }?.let(viewModel::download)
            },
            onRename = { renameTarget = target },
            onMove = { moveTarget = target },
            onToggleStar = { viewModel.setStarred(target.id, target.isFolder, !target.starred) },
            onInfo = {
                if (target.isFolder) folderSheet = content.folders.firstOrNull { it.id == target.id }
                else fileSheet = content.files.firstOrNull { it.id == target.id }
            },
            onTrash = { viewModel.trash(target.id, target.isFolder) },
            onRestore = { viewModel.restore(target.id, target.isFolder) },
            onDismiss = { actionTarget = null },
        )
    }

    renameTarget?.let { target ->
        RenameDialog(
            current = target.name,
            onConfirm = { newName ->
                viewModel.rename(target.id, target.isFolder, newName)
                renameTarget = null
            },
            onDismiss = { renameTarget = null },
        )
    }

    moveTarget?.let { target ->
        MoveSheet(
            itemName = target.name,
            // Only the folders in view: a full tree picker lands with search.
            folders = content.folders.filter { it.id != target.id }.map { it.id to it.name },
            onPick = { destination ->
                viewModel.move(target.id, target.isFolder, destination)
                moveTarget = null
            },
            onDismiss = { moveTarget = null },
        )
    }

    fileSheet?.let { file ->
        FileInfoSheet(file = file, onDismiss = { fileSheet = null })
    }
    folderSheet?.let { folder ->
        FolderInfoSheet(folder = folder, onDismiss = { folderSheet = null })
    }
}

private fun FileEntity.asTarget() =
    ItemTarget(id = id, name = name, isFolder = false, starred = starred, trashed = trashed)

private fun FolderEntity.asTarget() =
    ItemTarget(id = id, name = name, isFolder = true, starred = starred, trashed = trashed)

@Composable
private fun EmptyFolder() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            Icons.Outlined.CloudUpload,
            contentDescription = null,
            tint = KubunoTheme.colors.textTertiary,
            modifier = Modifier.size(52.dp),
        )
        Spacer(Modifier.height(12.dp))
        Text(
            stringResource(R.string.browser_empty),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            stringResource(R.string.browser_empty_hint),
            style = MaterialTheme.typography.bodySmall,
            color = KubunoTheme.colors.textTertiary,
        )
    }
}

/** Shared empty state for the tabs whose data lands in a later milestone. */
@Composable
fun TabEmptyState(icon: androidx.compose.ui.graphics.vector.ImageVector, message: String, hint: String? = null) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = KubunoTheme.colors.textTertiary,
            modifier = Modifier.size(52.dp),
        )
        Spacer(Modifier.height(12.dp))
        Text(
            message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        hint?.let {
            Spacer(Modifier.height(4.dp))
            Text(it, style = MaterialTheme.typography.bodySmall, color = KubunoTheme.colors.textTertiary)
        }
    }
}

