package com.kubuno.android.ui.sheet

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kubuno.android.R
import com.kubuno.android.sync.db.FileEntity
import com.kubuno.android.sync.db.FolderEntity
import com.kubuno.android.ui.browser.SortDir
import com.kubuno.android.ui.browser.SortField
import com.kubuno.android.ui.browser.sortFieldLabel
import com.kubuno.android.ui.format.SizeUnits
import com.kubuno.android.ui.format.formatModified
import com.kubuno.android.ui.format.formatSize
import com.kubuno.android.ui.theme.KubunoTheme

/**
 * Bottom sheet shell matching the web's MobileSheet: 16dp top corners, a 40x4
 * handle, a 14sp/600 title, and rows 52dp tall with a 20dp icon gutter.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActionSheet(
    title: String,
    onDismiss: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    val state = rememberModalBottomSheetState()
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = state,
        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        containerColor = MaterialTheme.colorScheme.surface,
        dragHandle = {
            Box(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 2.dp), contentAlignment = Alignment.Center) {
                Box(
                    Modifier
                        .size(width = 40.dp, height = 4.dp)
                        .background(KubunoTheme.colors.borderStrong, RoundedCornerShape(2.dp))
                )
            }
        },
    ) {
        Column(Modifier.navigationBarsPadding().padding(bottom = 12.dp)) {
            Text(
                title,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 8.dp),
            )
            content()
        }
    }
}

typealias ColumnScope = androidx.compose.foundation.layout.ColumnScope

@Composable
fun SheetRow(
    label: String,
    icon: ImageVector? = null,
    selected: Boolean = false,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(52.dp)
            .background(
                if (selected) MaterialTheme.colorScheme.primaryContainer
                else MaterialTheme.colorScheme.surface
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) {
            icon?.let {
                Icon(
                    it,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
        Text(
            label,
            fontSize = 15.sp,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (selected) {
            Icon(
                Icons.Outlined.Check,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(17.dp),
            )
        }
    }
}

@Composable
private fun SheetSeparator() {
    Spacer(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .height(1.dp)
            .background(MaterialTheme.colorScheme.outline)
    )
}

/** Sort sheet: four criteria, then the direction pair whose wording follows the field. */
@Composable
fun SortSheet(
    field: SortField,
    dir: SortDir,
    onField: (SortField) -> Unit,
    onDir: (SortDir) -> Unit,
    onDismiss: () -> Unit,
) {
    ActionSheet(title = stringResource(R.string.sort_by), onDismiss = onDismiss) {
        SortField.entries.forEach { candidate ->
            SheetRow(
                label = sortFieldLabel(candidate),
                selected = candidate == field,
                onClick = { onField(candidate); onDismiss() },
            )
        }
        SheetSeparator()
        val (ascLabel, descLabel) = when (field) {
            SortField.NAME, SortField.TYPE ->
                stringResource(R.string.sort_a_to_z) to stringResource(R.string.sort_z_to_a)
            SortField.SIZE ->
                stringResource(R.string.sort_smallest) to stringResource(R.string.sort_largest)
            SortField.DATE ->
                stringResource(R.string.sort_oldest) to stringResource(R.string.sort_newest)
        }
        SheetRow(label = ascLabel, selected = dir == SortDir.ASC, onClick = { onDir(SortDir.ASC); onDismiss() })
        SheetRow(label = descLabel, selected = dir == SortDir.DESC, onClick = { onDir(SortDir.DESC); onDismiss() })
    }
}

@Composable
private fun InfoLine(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = KubunoTheme.colors.textTertiary,
            modifier = Modifier.weight(0.4f),
        )
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(0.6f),
        )
    }
}

@Composable
private fun sizeUnits() = SizeUnits(
    byte = stringResource(R.string.unit_byte),
    kb = stringResource(R.string.unit_kb),
    mb = stringResource(R.string.unit_mb),
    gb = stringResource(R.string.unit_gb),
)

/**
 * File details, read straight from the local store so it works offline.
 * The rest of the web's context menu (rename, move, share, trash) needs write
 * endpoints and arrives with the outbox in M3.
 */
@Composable
fun FileInfoSheet(file: FileEntity, onDismiss: () -> Unit) {
    ActionSheet(title = stringResource(R.string.ctx_info_file), onDismiss = onDismiss) {
        Text(
            file.name,
            fontSize = 15.sp,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )
        Spacer(Modifier.height(4.dp))
        InfoLine(stringResource(R.string.info_size), formatSize(file.size, sizeUnits()))
        file.mimeType?.let { InfoLine(stringResource(R.string.info_type), it) }
        formatModified(file.updatedAt)?.let { InfoLine(stringResource(R.string.row_modified), it) }
        file.etag?.let { InfoLine(stringResource(R.string.info_checksum), it.take(16) + "…") }
    }
}

@Composable
fun FolderInfoSheet(folder: FolderEntity, onDismiss: () -> Unit) {
    ActionSheet(title = stringResource(R.string.ctx_info_folder), onDismiss = onDismiss) {
        Text(
            folder.name,
            fontSize = 15.sp,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )
        Spacer(Modifier.height(4.dp))
        InfoLine(stringResource(R.string.info_path), folder.path)
        formatModified(folder.updatedAt)?.let { InfoLine(stringResource(R.string.row_modified), it) }
    }
}
