package com.kubuno.android.ui.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.People
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.kubuno.android.R

/** The drive module's four mobile tabs, in the order declared by its entry.ts. */
enum class DriveTab(val route: String) {
    HOME("tab/home"),
    STARRED("tab/starred"),
    SHARED("tab/shared"),
    FILES("browser"),
}

private data class TabSpec(val tab: DriveTab, val icon: ImageVector, val labelRes: Int)

private val TABS = listOf(
    TabSpec(DriveTab.HOME, Icons.Outlined.Home, R.string.tab_home),
    TabSpec(DriveTab.STARRED, Icons.Filled.Star, R.string.tab_starred),
    TabSpec(DriveTab.SHARED, Icons.Outlined.People, R.string.tab_shared),
    TabSpec(DriveTab.FILES, Icons.Outlined.Folder, R.string.tab_files),
)

/**
 * Bottom navigation: 56dp row on white with a top border; the active tab wears
 * a 64x28 accent-light pill behind its 21dp glyph.
 */
@Composable
fun KubunoBottomNav(current: DriveTab, onSelect: (DriveTab) -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(MaterialTheme.colorScheme.outline),
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .height(56.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceAround,
        ) {
            TABS.forEach { spec ->
                val active = spec.tab == current
                Column(
                    modifier = Modifier
                        .clip(MaterialTheme.shapes.medium)
                        .clickable { onSelect(spec.tab) }
                        .padding(horizontal = 12.dp, vertical = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .width(64.dp)
                            .height(28.dp)
                            .clip(MaterialTheme.shapes.large)
                            .background(
                                if (active) MaterialTheme.colorScheme.primaryContainer
                                else androidx.compose.ui.graphics.Color.Transparent
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            spec.icon,
                            contentDescription = null,
                            tint = if (active) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(21.dp),
                        )
                    }
                    Text(
                        stringResource(spec.labelRes),
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (active) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.widthIn(max = 88.dp),
                    )
                }
            }
        }
    }
}
