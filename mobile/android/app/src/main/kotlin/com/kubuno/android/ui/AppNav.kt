package com.kubuno.android.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.util.Log
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.People
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.hilt.navigation.compose.hiltViewModel
import com.kubuno.android.account.AccountId
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.rememberCoroutineScope
import com.kubuno.android.ui.browse.BrowseViewModel
import com.kubuno.android.ui.browse.RecentScreen
import com.kubuno.android.ui.browse.SearchScreen
import com.kubuno.android.ui.browse.TrashScreen
import com.kubuno.android.ui.shell.DriveDrawer
import com.kubuno.android.ui.shell.DrawerDestination
import kotlinx.coroutines.launch
import com.kubuno.android.ui.account.AccountScreen
import com.kubuno.android.R
import com.kubuno.android.ui.browser.BrowserScreen
import com.kubuno.android.ui.browser.BrowserViewModel
import com.kubuno.android.ui.browser.TabEmptyState
import com.kubuno.android.ui.onboarding.LoginScreen
import com.kubuno.android.ui.onboarding.OnboardingViewModel
import com.kubuno.android.ui.onboarding.ServerScreen
import com.kubuno.android.ui.onboarding.TotpScreen
import com.kubuno.android.ui.sheet.NewFolderDialog
import com.kubuno.android.ui.shell.Crumb
import com.kubuno.android.ui.shell.DriveTab
import com.kubuno.android.ui.shell.KubunoShell
import com.kubuno.android.ui.settings.SettingsScreen
import com.kubuno.android.ui.starred.StarredScreen
import com.kubuno.android.ui.transfers.TransfersScreen
import com.kubuno.android.ui.transfers.TransfersViewModel

private enum class Stage { SERVER, LOGIN, TOTP }

/**
 * Picks between onboarding and the app.
 *
 * The account list decides: with none registered the device can only sign in.
 * Adding another account is that very same flow re-entered on top of the app,
 * which is why [adding] can hold it open while accounts already exist.
 *
 * @param startAddingAccount the activity was launched to add an account (from
 *   the system's account settings, through `KubunoAuthenticator`).
 * @param onAccountAdded reports the account that was just registered, so the
 *   authenticator's caller can be answered.
 */
@Composable
fun AppNav(
    startAddingAccount: Boolean = false,
    onAccountAdded: (AccountId) -> Unit = {},
    nav: AppNavViewModel = hiltViewModel(),
) {
    val onboarding: OnboardingViewModel = hiltViewModel()
    val onboardingState by onboarding.state.collectAsStateWithLifecycle()
    val accounts by nav.accounts.collectAsStateWithLifecycle()
    var adding by remember { mutableStateOf(startAddingAccount) }
    var stage by remember { mutableStateOf(Stage.SERVER) }

    LaunchedEffect(
        onboardingState.serverValidated,
        onboardingState.totpSession,
        onboardingState.done,
    ) {
        if (onboardingState.done) {
            // Sign-in already made the new account active, so leaving the flow
            // lands straight on it.
            nav.activeId.value?.let(onAccountAdded)
            adding = false
            onboarding.restart()
            stage = Stage.SERVER
            return@LaunchedEffect
        }
        stage = when {
            onboardingState.totpSession != null -> Stage.TOTP
            onboardingState.serverValidated -> Stage.LOGIN
            else -> Stage.SERVER
        }
    }

    if (accounts.isEmpty() || adding) {
        when (stage) {
            Stage.SERVER -> ServerScreen(onboarding)
            Stage.LOGIN -> LoginScreen(onboarding)
            Stage.TOTP -> TotpScreen(onboarding)
        }
        // Backing out of "add account" returns to the app, never to a blank
        // slate — there is nothing to go back to when it is the first sign-in.
        BackHandler(enabled = adding) {
            adding = false
            onboarding.restart()
        }
        return
    }

    SignedInApp(
        nav = nav,
        onAddAccount = {
            onboarding.restart()
            stage = Stage.SERVER
            adding = true
        },
    )
}

@Composable
private fun SignedInApp(nav: AppNavViewModel, onAddAccount: () -> Unit) {
    val context = LocalContext.current
    val accounts by nav.accounts.collectAsStateWithLifecycle()
    val activeId by nav.activeId.collectAsStateWithLifecycle()
    var tab by remember { mutableStateOf(DriveTab.FILES) }
    // Folder navigation is a stack of crumbs; the last one is the open folder.
    val stack = remember { mutableStateListOf<Crumb>() }
    val currentFolderId = stack.lastOrNull()?.id

    val viewModel: BrowserViewModel = hiltViewModel()
    val transfersViewModel: TransfersViewModel = hiltViewModel()
    val content by viewModel.content.collectAsStateWithLifecycle()
    val transfers by transfersViewModel.transfers.collectAsStateWithLifecycle()
    val browseViewModel: BrowseViewModel = hiltViewModel()
    val rootFolders by browseViewModel.rootFolders.collectAsStateWithLifecycle()
    var newFolderDialog by remember { mutableStateOf(false) }
    var showSettings by remember { mutableStateOf(false) }
    var showAccount by remember { mutableStateOf(false) }
    var showTransfers by remember { mutableStateOf(false) }
    // Non-null means the header is in search mode; the string is the term.
    var searchQuery by remember { mutableStateOf<String?>(null) }
    var drawerSection by remember { mutableStateOf(DrawerDestination.MY_DRIVE) }
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()

    fun closeOverlays() {
        showAccount = false
        showSettings = false
        showTransfers = false
        searchQuery = null
    }

    LaunchedEffect(currentFolderId) { viewModel.openFolder(currentFolderId) }

    // Another account means another tree: folder ids are not comparable across
    // instances, so the breadcrumb has to start over.
    LaunchedEffect(activeId) {
        closeOverlays()
        stack.clear()
        tab = DriveTab.FILES
        drawerSection = DrawerDestination.MY_DRIVE
    }

    val picker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments()
    ) { uris -> if (uris.isNotEmpty()) viewModel.upload(uris) }

    BackHandler(
        enabled = drawerState.isOpen || searchQuery != null || showAccount || showSettings || showTransfers ||
            drawerSection != DrawerDestination.MY_DRIVE || stack.isNotEmpty() || tab != DriveTab.FILES
    ) {
        when {
            drawerState.isOpen -> scope.launch { drawerState.close() }
            searchQuery != null -> searchQuery = null
            showAccount -> showAccount = false
            showSettings -> showSettings = false
            showTransfers -> showTransfers = false
            drawerSection != DrawerDestination.MY_DRIVE -> drawerSection = DrawerDestination.MY_DRIVE
            stack.isNotEmpty() -> stack.removeAt(stack.lastIndex)
            else -> tab = DriveTab.FILES
        }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            DriveDrawer(
                current = drawerSection,
                rootFolders = rootFolders.map { it.id to it.name },
                onDestination = { destination ->
                    scope.launch { drawerState.close() }
                    closeOverlays()
                    drawerSection = destination
                    when (destination) {
                        DrawerDestination.MY_DRIVE -> { tab = DriveTab.FILES; stack.clear() }
                        DrawerDestination.STARRED -> tab = DriveTab.STARRED
                        DrawerDestination.SHARED -> tab = DriveTab.SHARED
                        DrawerDestination.SETTINGS -> showSettings = true
                        else -> Unit // Recent and Trash render in place
                    }
                },
                onOpenFolder = { id ->
                    scope.launch { drawerState.close() }
                    closeOverlays()
                    drawerSection = DrawerDestination.MY_DRIVE
                    tab = DriveTab.FILES
                    stack.clear()
                    stack.add(Crumb(id, rootFolders.firstOrNull { it.id == id }?.name.orEmpty()))
                },
                onNew = { scope.launch { drawerState.close() }; newFolderDialog = true },
            )
        },
    ) {

    KubunoShell(
        crumbs = if (tab == DriveTab.FILES) stack.toList() else emptyList(),
        currentTab = tab,
        userLabel = viewModel.userLabel,
        userEmail = viewModel.userEmail,
        avatarUrl = viewModel.avatarUrl,
        accounts = accounts,
        activeId = activeId,
        onSwitchAccount = { nav.switchTo(it) },
        onAddAccount = onAddAccount,
        onManageDeviceAccounts = { openDeviceAccounts(context) },
        childFolders = if (tab == DriveTab.FILES && !showTransfers && !showSettings) {
            content.folders.map { it.id to it.name }
        } else emptyList(),
        showFab = tab == DriveTab.FILES && !showTransfers && !showSettings &&
            searchQuery == null && !showAccount && drawerSection == DrawerDestination.MY_DRIVE,
        showBreadcrumb = tab == DriveTab.FILES && !showTransfers && !showSettings &&
            searchQuery == null && !showAccount && drawerSection == DrawerDestination.MY_DRIVE,
        activeTransfers = transfers.count { it.state == "queued" || it.state == "running" },
        onOpenTransfers = { closeOverlays(); showTransfers = true },
        onOpenSettings = { closeOverlays(); showSettings = true },
        onManageAccount = { closeOverlays(); showAccount = true },
        searchQuery = searchQuery,
        onSearchOpen = { closeOverlays(); searchQuery = "" },
        onSearchChange = { searchQuery = it; browseViewModel.search(it) },
        onSearchClose = { searchQuery = null; browseViewModel.search("") },
        onOpenDrawer = { scope.launch { drawerState.open() } },
        onSelectTab = { selected ->
            closeOverlays()
            drawerSection = when (selected) {
                DriveTab.STARRED -> DrawerDestination.STARRED
                DriveTab.SHARED -> DrawerDestination.SHARED
                else -> DrawerDestination.MY_DRIVE
            }
            if (selected == DriveTab.FILES && tab == DriveTab.FILES) stack.clear()
            tab = selected
        },
        onNavigateCrumb = { id ->
            if (id == null) {
                stack.clear()
            } else {
                val index = stack.indexOfFirst { it.id == id }
                if (index >= 0) while (stack.lastIndex > index) stack.removeAt(stack.lastIndex)
            }
        },
        onOpenFolder = { id ->
            val name = content.folders.firstOrNull { it.id == id }?.name.orEmpty()
            stack.add(Crumb(id, name))
        },
        onNewFolder = { newFolderDialog = true },
        onUploadFiles = { picker.launch(arrayOf("*/*")) },
        onLogout = { nav.signOutActive() },
    ) {
        // Settings and transfers take over the module surface rather than
        // becoming tabs: the four drive tabs are fixed by the web's design.
        when {
            showAccount -> AccountScreen(
                viewModel = hiltViewModel(),
                onLogout = { nav.signOutActive() },
            )
            searchQuery != null -> SearchScreen(
                viewModel = browseViewModel,
                onOpenFolder = { id ->
                    searchQuery = null
                    stack.clear()
                    stack.add(Crumb(id, ""))
                },
            )
            drawerSection == DrawerDestination.RECENT -> RecentScreen(browseViewModel)
            drawerSection == DrawerDestination.TRASH -> TrashScreen(browseViewModel) {}
            showSettings -> SettingsScreen(
                viewModel = hiltViewModel(),
                onPurgeOffline = { viewModel.purgeOffline() },
            )

            showTransfers -> TransfersScreen(viewModel = transfersViewModel)

            else -> when (tab) {
                DriveTab.FILES -> BrowserScreen(
                    viewModel = viewModel,
                    onOpenFolder = { id ->
                        val name = content.folders.firstOrNull { it.id == id }?.name.orEmpty()
                        stack.add(Crumb(id, name))
                    },
                )
                DriveTab.STARRED -> StarredScreen(viewModel = hiltViewModel())
                DriveTab.SHARED -> TabEmptyState(
                    icon = Icons.Outlined.People,
                    message = stringResource(R.string.empty_shared),
                )
                DriveTab.HOME -> TabEmptyState(
                    icon = Icons.Outlined.Home,
                    message = stringResource(R.string.empty_recent),
                )
            }
        }
    }

    }

    if (newFolderDialog) {
        NewFolderDialog(
            onConfirm = { name ->
                viewModel.createFolder(name)
                newFolderDialog = false
            },
            onDismiss = { newFolderDialog = false },
        )
    }
}

/**
 * Opens the system's account settings, which is what Drive's "manage accounts
 * on this device" does. There is no public Intent to pre-filter that screen by
 * account type, so it opens on the full list. Failures are swallowed: a few
 * builds (TV, some tablets) ship without the activity, and a crash would be a
 * worse answer than nothing happening.
 */
private fun openDeviceAccounts(context: Context) {
    try {
        context.startActivity(
            Intent(Settings.ACTION_SYNC_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    } catch (e: ActivityNotFoundException) {
        Log.w("AppNav", "No account settings activity on this device", e)
    }
}
