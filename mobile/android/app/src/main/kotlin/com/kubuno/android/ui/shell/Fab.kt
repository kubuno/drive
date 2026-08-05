package com.kubuno.android.ui.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material.icons.outlined.FileUpload
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.kubuno.android.R
import com.kubuno.android.ui.sheet.ActionSheet
import com.kubuno.android.ui.sheet.SheetRow

/**
 * The web launches an app switcher from this button; the Android client only
 * ships the drive, so the same silhouette opens the "New" actions instead:
 * a 56dp rounded square in primary with a blue-tinted drop shadow, scaling to
 * 0.95 while pressed.
 *
 * Both actions are pure callbacks — the outbox and the upload queue own them.
 */
@Composable
fun NewActionsFab(
    onNewFolder: () -> Unit,
    onUploadFiles: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var sheet by remember { mutableStateOf(false) }
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale = if (pressed) 0.95f else 1f
    val accent = MaterialTheme.colorScheme.primary

    Box(
        modifier = modifier
            .graphicsLayer { scaleX = scale; scaleY = scale }
            // Approximates `0 4px 14px rgba(26,115,232,0.45)`.
            .shadow(
                elevation = 10.dp,
                shape = RoundedCornerShape(8.dp),
                ambientColor = accent,
                spotColor = accent,
            )
            .size(56.dp)
            .background(accent, RoundedCornerShape(8.dp))
            .clickable(
                interactionSource = interaction,
                indication = ripple(bounded = true),
                onClick = { sheet = true },
            ),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Outlined.Add,
            contentDescription = stringResource(R.string.fab_new),
            tint = MaterialTheme.colorScheme.onPrimary,
            modifier = Modifier.size(26.dp),
        )
    }

    if (sheet) {
        NewActionsSheet(
            onNewFolder = { sheet = false; onNewFolder() },
            onUploadFiles = { sheet = false; onUploadFiles() },
            onDismiss = { sheet = false },
        )
    }
}

@Composable
private fun NewActionsSheet(
    onNewFolder: () -> Unit,
    onUploadFiles: () -> Unit,
    onDismiss: () -> Unit,
) {
    ActionSheet(title = stringResource(R.string.fab_new), onDismiss = onDismiss) {
        SheetRow(
            label = stringResource(R.string.new_folder),
            icon = Icons.Outlined.CreateNewFolder,
            onClick = onNewFolder,
        )
        SheetRow(
            label = stringResource(R.string.upload_files),
            icon = Icons.Outlined.FileUpload,
            onClick = onUploadFiles,
        )
    }
}
