package com.kubuno.android.ui.settings

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.work.WorkManager
import com.kubuno.android.BuildConfig
import com.kubuno.android.R
import com.kubuno.android.account.AccountGraph
import com.kubuno.android.account.ActiveAccount
import com.kubuno.android.data.AccountPrefs
import com.kubuno.android.sync.work.AutoUploadWorker
import com.kubuno.android.ui.browser.ListContainer
import com.kubuno.android.ui.browser.RowDivider
import com.kubuno.android.ui.browser.SectionTitle
import com.kubuno.android.ui.format.SizeUnits
import com.kubuno.android.ui.format.formatSize
import com.kubuno.android.ui.theme.KubunoTheme
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * Auto-upload settings belong to the displayed account: the destination is a
 * folder on *its* server and the media checkpoint says what *it* has seen, so
 * they live in [AccountPrefs] behind [AccountGraph], not in the device-wide
 * preferences.
 *
 * [AccountPrefs] is plain SharedPreferences and emits nothing, so each switch
 * reads it again whenever the account changes or a write bumps [revision]; the
 * preference stays the source of truth for the worker, the flow only drives
 * recomposition.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class SettingsViewModel @Inject constructor(
    active: ActiveAccount,
    private val workManager: WorkManager,
) : ViewModel() {

    private val graph: StateFlow<AccountGraph?> = active.graph

    /** Bumped after every write, since the preferences themselves are silent. */
    private val revision = MutableStateFlow(0)

    private val prefs: Flow<AccountPrefs?> = combine(graph, revision) { g, _ -> g?.prefs }

    private fun <T> pref(initial: T, read: (AccountPrefs) -> T): StateFlow<T> =
        prefs.map { p -> p?.let(read) ?: initial }
            // Eager: a write must land even if the screen is momentarily
            // unsubscribed, otherwise the switch would snap back.
            .stateIn(viewModelScope, SharingStarted.Eagerly, graph.value?.prefs?.let(read) ?: initial)

    val autoUpload: StateFlow<Boolean> = pref(false) { it.autoUploadEnabled }
    val wifiOnly: StateFlow<Boolean> = pref(true) { it.autoUploadWifiOnly }
    val whileCharging: StateFlow<Boolean> = pref(false) { it.autoUploadWhileCharging }
    val videos: StateFlow<Boolean> = pref(false) { it.autoUploadVideos }

    val uploadedCount: StateFlow<Int> = graph
        .flatMapLatest { g -> g?.db?.autoUploadDao()?.count() ?: flowOf(0) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)

    val offlineBytes: StateFlow<Long> = graph
        .flatMapLatest { g -> g?.db?.pinDao()?.offlineBytes() ?: flowOf(0L) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0L)

    fun setAutoUpload(enabled: Boolean) = edit { prefs ->
        // Anchor the cutoff the first time the feature is turned on, otherwise
        // the worker would walk the entire camera roll on its first run.
        if (enabled && prefs.autoUploadSince == 0L) {
            prefs.autoUploadSince = System.currentTimeMillis() / 1000
        }
        prefs.autoUploadEnabled = enabled
    }

    fun setWifiOnly(value: Boolean) = edit { it.autoUploadWifiOnly = value }

    fun setWhileCharging(value: Boolean) = edit { it.autoUploadWhileCharging = value }

    fun setVideos(value: Boolean) = edit { it.autoUploadVideos = value }

    /**
     * Writes on the displayed account, then re-arms its worker. Constraints and
     * content triggers are baked into the request, so every change has to
     * re-enqueue the work rather than just update a flag — and it is enqueued
     * per account, so one account's settings never touch another's jobs.
     */
    private fun edit(block: (AccountPrefs) -> Unit) {
        val g = graph.value ?: return
        block(g.prefs)
        revision.value++
        AutoUploadWorker.schedule(workManager, g.id, g.prefs)
    }
}

@Composable
private fun sizeUnits() = SizeUnits(
    byte = stringResource(R.string.unit_byte),
    kb = stringResource(R.string.unit_kb),
    mb = stringResource(R.string.unit_mb),
    gb = stringResource(R.string.unit_gb),
)

/** Permissions the auto-upload scan needs: granular from API 33, legacy below. */
private fun mediaPermissions(includeVideos: Boolean): Array<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        buildList {
            add(Manifest.permission.READ_MEDIA_IMAGES)
            if (includeVideos) add(Manifest.permission.READ_MEDIA_VIDEO)
        }.toTypedArray()
    } else {
        arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }

@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    onPurgeOffline: () -> Unit,
) {
    val context = LocalContext.current
    val autoUpload by viewModel.autoUpload.collectAsStateWithLifecycle()
    val wifiOnly by viewModel.wifiOnly.collectAsStateWithLifecycle()
    val whileCharging by viewModel.whileCharging.collectAsStateWithLifecycle()
    val videos by viewModel.videos.collectAsStateWithLifecycle()
    val uploadedCount by viewModel.uploadedCount.collectAsStateWithLifecycle()
    val offlineBytes by viewModel.offlineBytes.collectAsStateWithLifecycle()

    // The switch must only move once the user has actually granted the media
    // read, so the pending write waits here for the launcher's verdict.
    var pendingGrant by remember { mutableStateOf<(() -> Unit)?>(null) }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        val action = pendingGrant
        pendingGrant = null
        // A partial grant would make the scan silently skip a collection.
        if (action != null && grants.values.all { it }) action()
    }

    fun withMediaPermission(includeVideos: Boolean, action: () -> Unit) {
        val required = mediaPermissions(includeVideos)
        val granted = required.all {
            ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
        }
        if (granted) {
            action()
        } else {
            pendingGrant = action
            permissionLauncher.launch(required)
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 12.dp),
    ) {
        SectionTitle(stringResource(R.string.settings_autoupload))
        ListContainer {
            SwitchRow(
                label = stringResource(R.string.autoupload_enabled),
                checked = autoUpload,
                onCheckedChange = { wanted ->
                    if (wanted) {
                        withMediaPermission(videos) { viewModel.setAutoUpload(true) }
                    } else {
                        viewModel.setAutoUpload(false)
                    }
                },
            )
            RowDivider()
            SwitchRow(
                label = stringResource(R.string.autoupload_wifi),
                checked = wifiOnly,
                enabled = autoUpload,
                onCheckedChange = viewModel::setWifiOnly,
            )
            RowDivider()
            SwitchRow(
                label = stringResource(R.string.autoupload_charging),
                checked = whileCharging,
                enabled = autoUpload,
                onCheckedChange = viewModel::setWhileCharging,
            )
            RowDivider()
            SwitchRow(
                label = stringResource(R.string.autoupload_videos),
                checked = videos,
                enabled = autoUpload,
                onCheckedChange = { wanted ->
                    // Videos live behind their own runtime permission from API 33.
                    if (wanted) {
                        withMediaPermission(includeVideos = true) { viewModel.setVideos(true) }
                    } else {
                        viewModel.setVideos(false)
                    }
                },
            )
            RowDivider()
            SettingsRow(
                label = stringResource(R.string.autoupload_count, uploadedCount),
            )
        }

        Spacer(Modifier.height(20.dp))

        SectionTitle(stringResource(R.string.settings_offline))
        ListContainer {
            SettingsRow(
                label = stringResource(R.string.offline_size),
                value = formatSize(offlineBytes, sizeUnits()),
            )
            RowDivider()
            SettingsRow(
                label = stringResource(R.string.offline_purge),
                onClick = onPurgeOffline,
            )
        }

        Spacer(Modifier.height(20.dp))

        SectionTitle(stringResource(R.string.settings_about))
        ListContainer {
            SettingsRow(
                label = stringResource(R.string.app_name),
                value = BuildConfig.VERSION_NAME,
            )
            RowDivider()
            SettingsRow(label = stringResource(R.string.about_license))
        }

        Spacer(Modifier.height(24.dp))
    }
}

/** Two-line identity row: the display name over the address it signs in with. */
/**
 * Generic settings line, 52dp like [com.kubuno.android.ui.sheet.SheetRow].
 * Without [onClick] it is a plain readout — no ripple, nothing to press.
 */
@Composable
private fun SettingsRow(
    label: String,
    value: String? = null,
    danger: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(52.dp)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            label,
            fontSize = 15.sp,
            color = if (danger) MaterialTheme.colorScheme.error
            else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (value != null) {
            Text(
                value,
                style = MaterialTheme.typography.bodySmall,
                color = KubunoTheme.colors.textTertiary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun SwitchRow(
    label: String,
    checked: Boolean,
    enabled: Boolean = true,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(52.dp)
            .padding(start = 16.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            label,
            fontSize = 15.sp,
            color = if (enabled) MaterialTheme.colorScheme.onSurface
            else KubunoTheme.colors.textTertiary,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Switch(checked = checked, onCheckedChange = onCheckedChange, enabled = enabled)
    }
}
