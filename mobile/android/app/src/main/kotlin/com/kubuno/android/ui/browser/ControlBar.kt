package com.kubuno.android.ui.browser

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.List
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kubuno.android.R

enum class SortField { NAME, DATE, SIZE, TYPE }
enum class SortDir { ASC, DESC }
enum class ViewMode { LIST, GRID }

@Composable
fun sortFieldLabel(field: SortField): String = stringResource(
    when (field) {
        SortField.NAME -> R.string.sort_name
        SortField.DATE -> R.string.sort_date
        SortField.SIZE -> R.string.sort_size
        SortField.TYPE -> R.string.sort_type
    }
)

/**
 * Mobile control bar: a sort chip, a direction toggle, and the list/grid pair.
 * Transcribed from core/frontend/src/drive/storage-explorer/toolbars.tsx.
 */
@Composable
fun MobileControlBar(
    sortField: SortField,
    sortDir: SortDir,
    view: ViewMode,
    onSortClick: () -> Unit,
    onToggleDir: () -> Unit,
    onView: (ViewMode) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(
                modifier = Modifier
                    .height(36.dp)
                    .clip(RoundedCornerShape(50))
                    .clickable(onClick = onSortClick)
                    .padding(start = 4.dp, end = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    sortFieldLabel(sortField),
                    fontSize = 15.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(RoundedCornerShape(50))
                    .background(MaterialTheme.colorScheme.primaryContainer)
                    .clickable(onClick = onToggleDir),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Outlined.ArrowUpward,
                    contentDescription = stringResource(R.string.sort_direction),
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier
                        .size(17.dp)
                        .rotate(if (sortDir == SortDir.DESC) 180f else 0f),
                )
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            ViewToggle(
                icon = Icons.AutoMirrored.Outlined.List,
                label = stringResource(R.string.view_list),
                active = view == ViewMode.LIST,
                onClick = { onView(ViewMode.LIST) },
            )
            ViewToggle(
                icon = Icons.Outlined.GridView,
                label = stringResource(R.string.view_grid),
                active = view == ViewMode.GRID,
                onClick = { onView(ViewMode.GRID) },
            )
        }
    }
}

/** Active state is an inverted pill (dark fill, white glyph), not an accent wash. */
@Composable
private fun ViewToggle(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    active: Boolean,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .width(56.dp)
            .height(36.dp)
            .clip(RoundedCornerShape(50))
            .background(
                if (active) MaterialTheme.colorScheme.onSurface
                else MaterialTheme.colorScheme.primaryContainer
            )
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = label,
            tint = if (active) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(18.dp),
        )
    }
}
