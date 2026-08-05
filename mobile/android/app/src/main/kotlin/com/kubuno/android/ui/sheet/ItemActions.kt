package com.kubuno.android.ui.sheet

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.automirrored.outlined.DriveFileMove
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.RestoreFromTrash
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kubuno.android.R

/** What the browser needs to act on one item, file or folder alike. */
data class ItemTarget(
    val id: String,
    val name: String,
    val isFolder: Boolean,
    val starred: Boolean,
    val trashed: Boolean,
)

/**
 * Item menu, ordered like the web's context menu: download, rename, move,
 * star, info, then the destructive entry last and in red.
 */
@Composable
fun ItemActionSheet(
    target: ItemTarget,
    onDownload: () -> Unit,
    onRename: () -> Unit,
    onMove: () -> Unit,
    onToggleStar: () -> Unit,
    onInfo: () -> Unit,
    onTrash: () -> Unit,
    onRestore: () -> Unit,
    onDismiss: () -> Unit,
) {
    ActionSheet(title = target.name, onDismiss = onDismiss) {
        if (!target.isFolder && !target.trashed) {
            SheetRow(
                label = stringResource(R.string.action_download),
                icon = Icons.Outlined.Download,
                onClick = { onDismiss(); onDownload() },
            )
        }
        if (!target.trashed) {
            SheetRow(
                label = stringResource(R.string.action_rename),
                icon = Icons.Outlined.Edit,
                onClick = { onDismiss(); onRename() },
            )
            SheetRow(
                label = stringResource(R.string.action_move),
                icon = Icons.AutoMirrored.Outlined.DriveFileMove,
                onClick = { onDismiss(); onMove() },
            )
            SheetRow(
                label = stringResource(
                    if (target.starred) R.string.action_unstar else R.string.action_star
                ),
                icon = if (target.starred) Icons.Filled.Star else Icons.Outlined.StarBorder,
                onClick = { onDismiss(); onToggleStar() },
            )
        }
        SheetRow(
            label = stringResource(
                if (target.isFolder) R.string.ctx_info_folder else R.string.ctx_info_file
            ),
            icon = Icons.Outlined.Info,
            onClick = { onDismiss(); onInfo() },
        )
        if (target.trashed) {
            SheetRow(
                label = stringResource(R.string.action_restore),
                icon = Icons.Outlined.RestoreFromTrash,
                onClick = { onDismiss(); onRestore() },
            )
        } else {
            DangerSheetRow(
                label = stringResource(R.string.action_trash),
                onClick = { onDismiss(); onTrash() },
            )
        }
    }
}

@Composable
private fun DangerSheetRow(label: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(52.dp)
            .background(MaterialTheme.colorScheme.surface)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Icon(
            Icons.Outlined.Delete,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.error,
            modifier = Modifier.size(20.dp),
        )
        Text(label, fontSize = 15.sp, color = MaterialTheme.colorScheme.error)
    }
}

/** Rename prompt; the text is preselected minus the extension, as file pickers do. */
@Composable
fun RenameDialog(current: String, onConfirm: (String) -> Unit, onDismiss: () -> Unit) {
    var value by remember { mutableStateOf(current) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.action_rename)) },
        text = {
            OutlinedTextField(
                value = value,
                onValueChange = { value = it },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(
                onClick = { if (value.isNotBlank()) onConfirm(value.trim()) },
                enabled = value.isNotBlank() && value != current,
            ) { Text(stringResource(R.string.action_confirm)) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) }
        },
    )
}

@Composable
fun NewFolderDialog(onConfirm: (String) -> Unit, onDismiss: () -> Unit) {
    var value by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.new_folder)) },
        text = {
            OutlinedTextField(
                value = value,
                onValueChange = { value = it },
                singleLine = true,
                placeholder = { Text(stringResource(R.string.new_folder_hint)) },
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(
                onClick = { if (value.isNotBlank()) onConfirm(value.trim()) },
                enabled = value.isNotBlank(),
            ) { Text(stringResource(R.string.action_confirm)) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) }
        },
    )
}

/** Destination picker: the current folder's children, plus the drive root. */
@Composable
fun MoveSheet(
    itemName: String,
    folders: List<Pair<String, String>>,
    onPick: (String?) -> Unit,
    onDismiss: () -> Unit,
) {
    ActionSheet(title = stringResource(R.string.action_move), onDismiss = onDismiss) {
        Text(
            itemName,
            fontSize = 15.sp,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )
        Column {
            SheetRow(
                label = stringResource(R.string.breadcrumb_root),
                icon = Icons.AutoMirrored.Outlined.DriveFileMove,
                onClick = { onDismiss(); onPick(null) },
            )
            folders.forEach { (id, name) ->
                SheetRow(
                    label = name,
                    icon = Icons.AutoMirrored.Outlined.DriveFileMove,
                    onClick = { onDismiss(); onPick(id) },
                )
            }
        }
    }
}
