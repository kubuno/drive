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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.layout.ContentScale
import coil3.compose.AsyncImage
import coil3.compose.LocalPlatformContext
import coil3.request.ImageRequest
import coil3.request.crossfade
import com.kubuno.android.account.AccountId
import com.kubuno.android.account.AccountRecord
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
    userEmail: String?,
    avatarUrl: String?,
    accounts: List<AccountRecord>,
    activeId: AccountId?,
    onSwitchAccount: (AccountId) -> Unit,
    onAddAccount: () -> Unit,
    onManageDeviceAccounts: () -> Unit,
    childFolders: List<Pair<String, String>>,
    showFab: Boolean,
    showBreadcrumb: Boolean,
    activeTransfers: Int,
    onOpenTransfers: () -> Unit,
    // Defaulted so the shell keeps compiling while AppNav wires the real screen.
    onOpenSettings: () -> Unit,
    onManageAccount: () -> Unit,
    searchQuery: String?,
    onSearchOpen: () -> Unit,
    onSearchChange: (String) -> Unit,
    onSearchClose: () -> Unit,
    onOpenDrawer: () -> Unit,
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
                userEmail = userEmail,
                avatarUrl = avatarUrl,
                accounts = accounts,
                activeId = activeId,
                onSwitchAccount = onSwitchAccount,
                onAddAccount = onAddAccount,
                onManageDeviceAccounts = onManageDeviceAccounts,
                searchQuery = searchQuery,
                onSearchOpen = onSearchOpen,
                onSearchChange = onSearchChange,
                onSearchClose = onSearchClose,
                onOpenDrawer = onOpenDrawer,
                activeTransfers = activeTransfers,
                onOpenTransfers = onOpenTransfers,
                onOpenSettings = onOpenSettings,
                onManageAccount = onManageAccount,
                onLogout = onLogout,
            )

            Column(
                Modifier
                    .weight(1f)
                    .padding(horizontal = 4.dp)
                    .clip(MaterialTheme.shapes.large)
                    .background(MaterialTheme.colorScheme.surface),
            ) {
                if (showBreadcrumb) {
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
private fun HeaderIcon(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: (() -> Unit)? = null,
) {
    Box(
        modifier = Modifier
            .size(48.dp)
            .clip(CircleShape)
            // Some header glyphs are still decorative: no ripple, no target.
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
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
    avatarUrl: String?,
    accounts: List<AccountRecord>,
    activeId: AccountId?,
    onSwitchAccount: (AccountId) -> Unit,
    onAddAccount: () -> Unit,
    onManageDeviceAccounts: () -> Unit,
    searchQuery: String?,
    onSearchOpen: () -> Unit,
    onSearchChange: (String) -> Unit,
    onSearchClose: () -> Unit,
    onOpenDrawer: () -> Unit,
    activeTransfers: Int,
    onOpenTransfers: () -> Unit,
    onOpenSettings: () -> Unit,
    onManageAccount: () -> Unit,
    userEmail: String?,
    onLogout: () -> Unit,
) {
    var panelOpen by remember { mutableStateOf(false) }

    // Searching swaps the whole header for a back arrow and a field, exactly
    // as the web does, rather than squeezing a field between the glyphs.
    if (searchQuery != null) {
        SearchHeader(
            query = searchQuery,
            onChange = onSearchChange,
            onClose = onSearchClose,
        )
        return
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .height(64.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        HeaderIcon(Icons.Outlined.Menu, stringResource(R.string.menu), onOpenDrawer)

        Icon(
            painter = painterResource(R.drawable.ic_kubuno_logo),
            contentDescription = stringResource(R.string.app_name),
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(width = 20.dp, height = 22.dp),
        )

        Box(Modifier.weight(1f))

        HeaderIcon(Icons.Outlined.Search, stringResource(R.string.search), onSearchOpen)
        // The bell is where transfer activity surfaces: same slot the web uses
        // for notifications, and the count is what the user wants to watch.
        NotificationBell(count = activeTransfers, onClick = onOpenTransfers)
        HeaderIcon(Icons.Outlined.Settings, stringResource(R.string.settings), onOpenSettings)

        Avatar(userLabel, avatarUrl) { panelOpen = true }
    }

    if (panelOpen) {
        UserPanel(
            email = userEmail,
            displayName = userLabel,
            avatarUrl = avatarUrl,
            accounts = accounts,
            activeId = activeId,
            onSwitchAccount = { panelOpen = false; onSwitchAccount(it) },
            onAddAccount = { panelOpen = false; onAddAccount() },
            onManageDeviceAccounts = { panelOpen = false; onManageDeviceAccounts() },
            onManageAccount = { panelOpen = false; onManageAccount() },
            onLogout = { panelOpen = false; onLogout() },
            onDismiss = { panelOpen = false },
        )
    }
}

@Composable
private fun SearchHeader(query: String, onChange: (String) -> Unit, onClose: () -> Unit) {
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .height(64.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        HeaderIcon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.back), onClose)
        BasicTextField(
            value = query,
            onValueChange = onChange,
            singleLine = true,
            textStyle = MaterialTheme.typography.bodyLarge.copy(
                color = MaterialTheme.colorScheme.onSurface,
            ),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            modifier = Modifier
                .weight(1f)
                .focusRequester(focusRequester),
            decorationBox = { inner ->
                if (query.isEmpty()) {
                    Text(
                        stringResource(R.string.search_hint),
                        style = MaterialTheme.typography.bodyLarge,
                        color = KubunoTheme.colors.textTertiary,
                    )
                }
                inner()
            },
        )
        if (query.isNotEmpty()) {
            HeaderIcon(Icons.Outlined.Close, stringResource(R.string.search_clear)) { onChange("") }
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

/**
 * Profile picture, falling back to initials.
 *
 * [avatarUrl] is server-relative, so it is joined to the current instance;
 * Coil rides the authenticated OkHttp client, which the avatar endpoint needs.
 */
@Composable
private fun Avatar(userLabel: String?, avatarUrl: String?, onClick: () -> Unit) {
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
        if (avatarUrl != null) {
            AsyncImage(
                model = ImageRequest.Builder(LocalPlatformContext.current)
                    .data(avatarUrl)
                    .crossfade(true)
                    .build(),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
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
