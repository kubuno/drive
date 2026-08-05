package com.kubuno.android.ui

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
import androidx.compose.ui.res.stringResource
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
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
import com.kubuno.android.ui.starred.StarredScreen
import com.kubuno.android.ui.transfers.TransfersScreen
import com.kubuno.android.ui.transfers.TransfersViewModel

private enum class Stage { SERVER, LOGIN, TOTP, SIGNED_IN }

@Composable
fun AppNav() {
    val onboarding: OnboardingViewModel = hiltViewModel()
    val onboardingState by onboarding.state.collectAsStateWithLifecycle()

    var stage by remember {
        mutableStateOf(
            when {
                !onboarding.client.hasServer() -> Stage.SERVER
                onboarding.client.tokenManager.isLoggedIn() -> Stage.SIGNED_IN
                else -> Stage.LOGIN
            }
        )
    }

    LaunchedEffect(
        onboardingState.serverValidated,
        onboardingState.totpSession,
        onboardingState.done,
    ) {
        stage = when {
            onboardingState.done -> Stage.SIGNED_IN
            onboardingState.totpSession != null -> Stage.TOTP
            onboardingState.serverValidated -> Stage.LOGIN
            stage == Stage.SIGNED_IN -> Stage.SIGNED_IN
            else -> Stage.SERVER
        }
    }

    when (stage) {
        Stage.SERVER -> ServerScreen(onboarding)
        Stage.LOGIN -> LoginScreen(onboarding)
        Stage.TOTP -> TotpScreen(onboarding)
        Stage.SIGNED_IN -> SignedInApp(onLoggedOut = { stage = Stage.LOGIN })
    }
}

@Composable
private fun SignedInApp(onLoggedOut: () -> Unit) {
    var tab by remember { mutableStateOf(DriveTab.FILES) }
    // Folder navigation is a stack of crumbs; the last one is the open folder.
    val stack = remember { mutableStateListOf<Crumb>() }
    val currentFolderId = stack.lastOrNull()?.id

    val viewModel: BrowserViewModel = hiltViewModel()
    val transfersViewModel: TransfersViewModel = hiltViewModel()
    val content by viewModel.content.collectAsStateWithLifecycle()
    val transfers by transfersViewModel.transfers.collectAsStateWithLifecycle()
    var newFolderDialog by remember { mutableStateOf(false) }
    var showTransfers by remember { mutableStateOf(false) }

    LaunchedEffect(currentFolderId) { viewModel.openFolder(currentFolderId) }

    val picker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments()
    ) { uris -> if (uris.isNotEmpty()) viewModel.upload(uris) }

    BackHandler(enabled = showTransfers || stack.isNotEmpty() || tab != DriveTab.FILES) {
        when {
            showTransfers -> showTransfers = false
            stack.isNotEmpty() -> stack.removeAt(stack.lastIndex)
            else -> tab = DriveTab.FILES
        }
    }

    KubunoShell(
        crumbs = if (tab == DriveTab.FILES) stack.toList() else emptyList(),
        currentTab = tab,
        userLabel = viewModel.userLabel,
        childFolders = if (tab == DriveTab.FILES && !showTransfers) {
            content.folders.map { it.id to it.name }
        } else emptyList(),
        showFab = tab == DriveTab.FILES && !showTransfers,
        activeTransfers = transfers.count { it.state == "queued" || it.state == "running" },
        onOpenTransfers = { showTransfers = true },
        onSelectTab = { selected ->
            showTransfers = false
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
        onLogout = { viewModel.logout(onLoggedOut) },
    ) {
        if (showTransfers) {
            TransfersScreen(viewModel = transfersViewModel)
            return@KubunoShell
        }
        when (tab) {
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
