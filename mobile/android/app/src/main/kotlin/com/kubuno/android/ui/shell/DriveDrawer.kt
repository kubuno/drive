package com.kubuno.android.ui.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Star
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kubuno.android.R
import com.kubuno.android.ui.theme.KubunoTheme

/** Where a drawer entry leads. Tabs already exist; these add the rest. */
enum class DrawerDestination { MY_DRIVE, RECENT, STARRED, SHARED, TRASH, SETTINGS }

/**
 * Off-canvas navigation, mirroring the web's mobile sidebar: the raised "New"
 * pill on top, then the destination list as 40dp rounded-full rows, then the
 * root folders for a direct jump.
 *
 * The panel is painted in --body-bg, not white — the web keeps the drawer on
 * the page background so the module card still reads as a separate surface.
 */
@Composable
fun DriveDrawer(
    current: DrawerDestination,
    rootFolders: List<Pair<String, String>>,
    onDestination: (DrawerDestination) -> Unit,
    onOpenFolder: (String) -> Unit,
    onNew: () -> Unit,
) {
    Column(
        Modifier
            .width(288.dp)
            .fillMaxHeight()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(vertical = 12.dp),
    ) {
        NewPill(onClick = onNew)
        Spacer(Modifier.height(12.dp))

        DrawerRow(Icons.Filled.Folder, stringResource(R.string.breadcrumb_root),
            current == DrawerDestination.MY_DRIVE) { onDestination(DrawerDestination.MY_DRIVE) }
        DrawerRow(Icons.Outlined.Schedule, stringResource(R.string.nav_recent),
            current == DrawerDestination.RECENT) { onDestination(DrawerDestination.RECENT) }
        DrawerRow(Icons.Outlined.Star, stringResource(R.string.tab_starred),
            current == DrawerDestination.STARRED) { onDestination(DrawerDestination.STARRED) }
        DrawerRow(Icons.Outlined.People, stringResource(R.string.tab_shared),
            current == DrawerDestination.SHARED) { onDestination(DrawerDestination.SHARED) }
        DrawerRow(Icons.Outlined.Delete, stringResource(R.string.nav_trash),
            current == DrawerDestination.TRASH) { onDestination(DrawerDestination.TRASH) }

        if (rootFolders.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Text(
                stringResource(R.string.section_folders).uppercase(),
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 0.6.sp,
                color = KubunoTheme.colors.textTertiary,
                modifier = Modifier.padding(start = 24.dp, top = 8.dp, bottom = 4.dp),
            )
            rootFolders.forEach { (id, name) ->
                DrawerRow(Icons.Filled.Folder, name, selected = false) { onOpenFolder(id) }
            }
        }

        Spacer(Modifier.height(8.dp))
        DrawerRow(Icons.Outlined.Settings, stringResource(R.string.settings),
            current == DrawerDestination.SETTINGS) { onDestination(DrawerDestination.SETTINGS) }
    }
}

/** The raised "New" button the web puts above the tree. */
@Composable
private fun NewPill(onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .padding(horizontal = 12.dp)
            .clip(RoundedCornerShape(20.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(20.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 25.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            Icons.Outlined.Add,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
        )
        Text(
            stringResource(R.string.fab_new),
            fontSize = 15.sp,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun DrawerRow(icon: ImageVector, label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 2.dp)
            .height(40.dp)
            .clip(CircleShape)
            .background(
                if (selected) MaterialTheme.colorScheme.primaryContainer
                else androidx.compose.ui.graphics.Color.Transparent
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = if (selected) MaterialTheme.colorScheme.primary
            else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
        )
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = if (selected) KubunoTheme.colors.navActive
            else MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
