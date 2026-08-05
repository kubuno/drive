package com.kubuno.android.ui.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kubuno.android.R
import com.kubuno.android.ui.sheet.ActionSheet
import com.kubuno.android.ui.sheet.SheetRow
import com.kubuno.android.ui.theme.KubunoTheme

data class Crumb(val id: String?, val name: String)

/**
 * App shell: a 64dp header painted in --body-bg (not white), the module
 * surface as a white rounded card laid on that background, the bottom tab bar,
 * and the "New" FAB floating above it.
 *
 * The header drops the wordmark below 640px, exactly as the web does, so the
 * phone sees the monogram alone.
 */
@Composable
fun KubunoShell(
    crumbs: List<Crumb>,
    currentTab: DriveTab,
    userLabel: String?,
    childFolders: List<Pair<String, String>>,
    showFab: Boolean,
    activeTransfers: Int,
    onOpenTransfers: () -> Unit,
    onSelectTab: (DriveTab) -> Unit,
    onNavigateCrumb: (String?) -> Unit,
    onOpenFolder: (String) -> Unit,
    onNewFolder: () -> Unit,
    onUploadFiles: () -> Unit,
    onLogout: () -> Unit,
    content: @Composable () -> Unit,
) {
    Box(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        Column(Modifier.fillMaxSize()) {
            AppHeader(
                userLabel = userLabel,
                activeTransfers = activeTransfers,
                onOpenTransfers = onOpenTransfers,
                onLogout = onLogout,
            )

            Column(
                Modifier
                    .weight(1f)
                    .padding(horizontal = 4.dp)
                    .clip(MaterialTheme.shapes.large)
                    .background(MaterialTheme.colorScheme.surface),
            ) {
                if (currentTab == DriveTab.FILES) {
                    Breadcrumb(
                        crumbs = crumbs,
                        childFolders = childFolders,
                        onNavigate = onNavigateCrumb,
                        onOpenFolder = onOpenFolder,
                    )
                }
                Box(Modifier.weight(1f)) { content() }
            }

            KubunoBottomNav(current = currentTab, onSelect = onSelectTab)
        }

        if (showFab) {
            Box(
                Modifier
                    .align(Alignment.BottomEnd)
                    .navigationBarsPadding()
                    .padding(end = 16.dp, bottom = 72.dp),
            ) {
                NewActionsFab(onNewFolder = onNewFolder, onUploadFiles = onUploadFiles)
            }
        }
    }
}

@Composable
private fun HeaderIcon(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String) {
    Box(
        modifier = Modifier
            .size(48.dp)
            .clip(CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = label,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
        )
    }
}

@Composable
private fun AppHeader(
    userLabel: String?,
    activeTransfers: Int,
    onOpenTransfers: () -> Unit,
    onLogout: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .height(64.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        HeaderIcon(Icons.Outlined.Menu, stringResource(R.string.menu))

        Icon(
            painter = painterResource(R.drawable.ic_kubuno_logo),
            contentDescription = stringResource(R.string.app_name),
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(width = 20.dp, height = 22.dp),
        )

        Box(Modifier.weight(1f))

        HeaderIcon(Icons.Outlined.Search, stringResource(R.string.search))
        // The bell is where transfer activity surfaces: same slot the web uses
        // for notifications, and the count is what the user wants to watch.
        NotificationBell(count = activeTransfers, onClick = onOpenTransfers)
        HeaderIcon(Icons.Outlined.Settings, stringResource(R.string.settings))

        Box {
            Avatar(userLabel) { menu = true }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.home_logout)) },
                    leadingIcon = {
                        Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null)
                    },
                    onClick = { menu = false; onLogout() },
                )
            }
        }
    }
}

@Composable
private fun NotificationBell(count: Int, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(48.dp)
            .clip(CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Outlined.Notifications,
            contentDescription = stringResource(R.string.notifications),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
        )
        if (count > 0) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(top = 10.dp, end = 8.dp)
                    .size(16.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.error),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    if (count > 9) "9+" else "$count",
                    fontSize = 10.sp,
                    color = MaterialTheme.colorScheme.onError,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

@Composable
private fun Avatar(userLabel: String?, onClick: () -> Unit) {
    val initials = userLabel
        ?.split(' ', '@', '.')
        ?.filter { it.isNotBlank() }
        ?.take(2)
        ?.joinToString("") { it.first().uppercase() }
        ?.ifBlank { null }
        ?: "?"
    Box(
        modifier = Modifier
            .padding(end = 6.dp)
            .size(36.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.primary)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            initials,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onPrimary,
        )
    }
}

/**
 * Home glyph, the root label, then chevron-separated segments. A "Go to"
 * button jumps straight into a child folder without walking the list.
 */
@Composable
private fun Breadcrumb(
    crumbs: List<Crumb>,
    childFolders: List<Pair<String, String>>,
    onNavigate: (String?) -> Unit,
    onOpenFolder: (String) -> Unit,
) {
    var gotoSheet by remember { mutableStateOf(false) }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(
            Icons.Outlined.Home,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
                .size(16.dp)
                .clickable { onNavigate(null) },
        )
        Text(
            stringResource(R.string.breadcrumb_root),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = if (crumbs.isEmpty()) MaterialTheme.colorScheme.onSurface
            else MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            modifier = Modifier
                .widthIn(max = 224.dp)
                .clickable { onNavigate(null) },
        )

        crumbs.forEachIndexed { index, crumb ->
            val last = index == crumbs.lastIndex
            Icon(
                Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                contentDescription = null,
                tint = KubunoTheme.colors.textTertiary,
                modifier = Modifier.size(14.dp),
            )
            Text(
                crumb.name,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = if (last) MaterialTheme.colorScheme.onSurface
                else MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .widthIn(max = 224.dp)
                    .then(if (last) Modifier else Modifier.clickable { onNavigate(crumb.id) }),
            )
        }

        if (childFolders.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .clip(MaterialTheme.shapes.small)
                    .border(1.dp, MaterialTheme.colorScheme.outline, MaterialTheme.shapes.small)
                    .clickable { gotoSheet = true }
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Icon(
                    Icons.Outlined.Folder,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(14.dp),
                )
                Text(
                    stringResource(R.string.goto_folder),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Icon(
                    Icons.Outlined.KeyboardArrowDown,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(14.dp),
                )
            }
        }
    }

    if (gotoSheet) {
        ActionSheet(title = stringResource(R.string.goto_folder), onDismiss = { gotoSheet = false }) {
            childFolders.forEach { (id, name) ->
                SheetRow(
                    label = name,
                    icon = Icons.Outlined.Folder,
                    onClick = { gotoSheet = false; onOpenFolder(id) },
                )
            }
        }
    }
}
