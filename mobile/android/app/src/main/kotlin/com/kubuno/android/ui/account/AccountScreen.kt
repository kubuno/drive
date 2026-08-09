package com.kubuno.android.ui.account

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import coil3.compose.AsyncImage
import coil3.compose.LocalPlatformContext
import coil3.request.ImageRequest
import coil3.request.crossfade
import com.kubuno.android.R
import com.kubuno.android.api.AuthApi
import com.kubuno.android.api.model.SessionDto
import com.kubuno.android.api.model.UserDto
import com.kubuno.android.data.AppPrefs
import com.kubuno.android.ui.browser.ListContainer
import com.kubuno.android.ui.browser.RowDivider
import com.kubuno.android.ui.browser.SectionTitle
import com.kubuno.android.ui.theme.KubunoTheme
import dagger.hilt.android.lifecycle.HiltViewModel
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import javax.inject.Inject
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The account screen — who you are signed in as, and from where.
 *
 * Deliberately NOT the drive's settings: those govern this installation
 * (auto-upload, offline copies), this one governs the account behind it. The
 * web makes the same split, `/settings` there being the account surface.
 *
 * Only what the mobile client can honestly serve is reproduced. Profile edits,
 * theme and notification preferences, API tokens and 2FA enrolment all stay on
 * the web, and the security section says so rather than showing a row that
 * would open nothing.
 */
data class AccountUiState(
    val loading: Boolean = true,
    val user: UserDto? = null,
    /** Absolute, ready for Coil — the server sends a relative path. */
    val avatarUrl: String? = null,
    val sessions: List<SessionDto> = emptyList(),
    val currentDeviceId: String? = null,
    /** `/me` did not answer: the cached identity is shown instead. */
    val profileFailed: Boolean = false,
    val sessionsFailed: Boolean = false,
    /** Session being revoked, so its row can stop accepting taps. */
    val revoking: String? = null,
)

@HiltViewModel
class AccountViewModel @Inject constructor(
    private val api: AuthApi,
    private val prefs: AppPrefs,
) : ViewModel() {

    /** Shown while `/me` is in flight, and kept if it never answers. */
    val cachedDisplayName: String? = prefs.userDisplayName
    val cachedEmail: String? = prefs.userEmail
    val serverUrl: String? = prefs.serverUrl

    private val _state = MutableStateFlow(
        AccountUiState(avatarUrl = absolute(prefs.userAvatarUrl))
    )
    val state: StateFlow<AccountUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        _state.update { it.copy(loading = true, profileFailed = false, sessionsFailed = false) }
        viewModelScope.launch {
            // Independent reads: a broken session list must not hide the profile.
            val (user, sessions) = coroutineScope {
                val profile = async { loadProfile() }
                val list = async { loadSessions() }
                profile.await() to list.await()
            }
            user?.let { cache(it) }
            _state.update {
                it.copy(
                    loading = false,
                    user = user ?: it.user,
                    avatarUrl = absolute(user?.avatarUrl ?: prefs.userAvatarUrl),
                    sessions = sessions?.first ?: emptyList(),
                    currentDeviceId = sessions?.second,
                    profileFailed = user == null,
                    sessionsFailed = sessions == null,
                )
            }
        }
    }

    /** Signs one session out, then reloads so the list cannot drift. */
    fun revokeSession(id: String) {
        if (_state.value.revoking != null) return
        _state.update { it.copy(revoking = id) }
        viewModelScope.launch {
            runCatching { api.revokeSession(id) }
            _state.update { it.copy(revoking = null) }
            refresh()
        }
    }

    /**
     * Revokes every session — the server has no "all but mine" variant, so this
     * one goes too. [onSignedOut] runs whatever the server answered: the local
     * tokens are worthless either way.
     */
    fun revokeAllSessions(onSignedOut: () -> Unit) {
        _state.update { it.copy(revoking = ALL_SESSIONS) }
        viewModelScope.launch {
            runCatching { api.revokeAllSessions() }
            _state.update { it.copy(revoking = null) }
            onSignedOut()
        }
    }

    private suspend fun loadProfile(): UserDto? =
        runCatching { api.me() }.getOrNull()
            ?.takeIf { it.isSuccessful }
            ?.body()
            ?.user

    /**
     * `/me/devices` first: it returns the same sessions plus `current_device_id`,
     * the only marker that tells this phone apart from the others. `/me/sessions`
     * is the fallback — same rows, no "this device" badge.
     */
    private suspend fun loadSessions(): Pair<List<SessionDto>, String?>? {
        runCatching { api.myDevices() }.getOrNull()
            ?.takeIf { it.isSuccessful }
            ?.body()
            ?.let { return it.sessions to it.currentDeviceId }

        runCatching { api.sessions() }.getOrNull()
            ?.takeIf { it.isSuccessful }
            ?.body()
            ?.let { return it.sessions to null }

        return null
    }

    private fun cache(user: UserDto) {
        prefs.userDisplayName = user.displayName ?: user.username
        prefs.userEmail = user.email
        prefs.userAvatarUrl = user.avatarUrl
    }

    /** Avatar paths are server-relative; Coil rides the authenticated client. */
    private fun absolute(path: String?): String? = when {
        path == null -> null
        path.startsWith("http") -> path
        else -> prefs.serverUrl?.trimEnd('/')?.plus(path)
    }

    companion object {
        /** Sentinel for [AccountUiState.revoking] while every session goes. */
        const val ALL_SESSIONS = "*"
    }
}

@Composable
fun AccountScreen(
    viewModel: AccountViewModel,
    onLogout: () -> Unit,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var confirmRevokeAll by remember { mutableStateOf(false) }

    // Nothing at all yet: the very first load, with no cache to fall back on.
    if (state.loading && state.user == null && viewModel.cachedEmail == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 12.dp),
    ) {
        SectionTitle(stringResource(R.string.account_profile))
        ListContainer {
            IdentityCard(
                displayName = state.user?.displayName ?: viewModel.cachedDisplayName,
                username = state.user?.username,
                email = state.user?.email ?: viewModel.cachedEmail,
                avatarUrl = state.avatarUrl,
            )
            RowDivider()
            AccountRow(
                label = stringResource(R.string.account_username),
                value = state.user?.username ?: EM_DASH,
            )
            RowDivider()
            AccountRow(
                label = stringResource(R.string.account_email),
                value = state.user?.email ?: viewModel.cachedEmail ?: EM_DASH,
            )
            RowDivider()
            AccountRow(
                label = stringResource(R.string.account_role),
                value = roleLabel(state.user?.role),
            )
        }

        if (state.profileFailed) {
            Notice(
                message = stringResource(
                    if (viewModel.cachedEmail != null) R.string.account_offline
                    else R.string.account_error
                ),
                onRetry = viewModel::refresh,
            )
        }

        Spacer(Modifier.height(20.dp))

        SectionTitle(stringResource(R.string.account_sessions))
        when {
            state.loading && state.sessions.isEmpty() -> ListContainer { LoadingRow() }

            state.sessionsFailed -> ListContainer {
                AccountRow(label = stringResource(R.string.account_error))
                RowDivider()
                AccountRow(
                    label = stringResource(R.string.account_retry),
                    onClick = viewModel::refresh,
                )
            }

            state.sessions.isEmpty() -> ListContainer {
                AccountRow(label = stringResource(R.string.account_sessions_empty))
            }

            else -> ListContainer {
                state.sessions.forEachIndexed { index, session ->
                    if (index > 0) RowDivider()
                    SessionRow(
                        session = session,
                        current = session.deviceId != null &&
                            session.deviceId == state.currentDeviceId,
                        busy = state.revoking != null,
                        onRevoke = { viewModel.revokeSession(session.id) },
                    )
                }
                RowDivider()
                AccountRow(
                    label = stringResource(R.string.account_sessions_revoke_all),
                    danger = true,
                    onClick = { confirmRevokeAll = true },
                )
            }
        }

        Spacer(Modifier.height(20.dp))

        SectionTitle(stringResource(R.string.account_security))
        ListContainer {
            AccountRow(
                label = stringResource(R.string.account_2fa),
                value = stringResource(
                    if (state.user?.totpEnabled == true) R.string.account_2fa_on
                    else R.string.account_2fa_off
                ),
            )
            RowDivider()
            // Read-only on purpose: enrolment, API tokens and profile edits are
            // web-only, and a row that opened nothing would be a lie.
            AccountRow(
                label = stringResource(R.string.account_manage_on_web),
                value = viewModel.serverUrl?.removePrefix("https://")?.removePrefix("http://"),
            )
        }

        Spacer(Modifier.height(20.dp))

        ListContainer {
            AccountRow(
                label = stringResource(R.string.home_logout),
                icon = Icons.AutoMirrored.Outlined.Logout,
                danger = true,
                onClick = onLogout,
            )
        }

        Spacer(Modifier.height(24.dp))
    }

    if (confirmRevokeAll) {
        AlertDialog(
            onDismissRequest = { confirmRevokeAll = false },
            title = { Text(stringResource(R.string.account_sessions_revoke_all)) },
            text = { Text(stringResource(R.string.account_sessions_revoke_all_message)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmRevokeAll = false
                    viewModel.revokeAllSessions(onLogout)
                }) {
                    Text(
                        stringResource(R.string.action_confirm),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmRevokeAll = false }) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
        )
    }
}

/** Portrait, name and address — the card the web opens the profile tab with. */
@Composable
private fun IdentityCard(
    displayName: String?,
    username: String?,
    email: String?,
    avatarUrl: String?,
) {
    val primary = displayName?.takeIf { it.isNotBlank() } ?: username ?: email ?: EM_DASH
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primary),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                initialsOf(displayName ?: username ?: email),
                fontSize = 24.sp,
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
        Column(Modifier.weight(1f)) {
            Text(
                primary,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (username != null && username != primary) {
                Text(
                    "@$username",
                    style = MaterialTheme.typography.bodySmall,
                    color = KubunoTheme.colors.textTertiary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (email != null && email != primary) {
                Text(
                    email,
                    style = MaterialTheme.typography.bodySmall,
                    color = KubunoTheme.colors.textTertiary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/**
 * One live session. The client kind names it when the device did not, and the
 * badge marks the rows that belong to this phone — the server correlates them
 * from the device key this client sends on every request.
 */
@Composable
private fun SessionRow(
    session: SessionDto,
    current: Boolean,
    busy: Boolean,
    onRevoke: () -> Unit,
) {
    val name = session.deviceLabel?.takeIf { it.isNotBlank() }
        ?: session.deviceName?.takeIf { it.isNotBlank() }
        ?: stringResource(clientLabel(session.clientType))
    val where = listOfNotNull(session.country, session.ipAddress).firstOrNull()
    val when_ = formatStamp(session.lastUsedAt ?: session.createdAt)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    name,
                    fontSize = 15.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (current) {
                    Text(
                        stringResource(R.string.account_session_current),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                        maxLines = 1,
                        modifier = Modifier
                            .clip(RoundedCornerShape(50))
                            .background(MaterialTheme.colorScheme.primaryContainer)
                            .padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                }
            }
            val meta = listOfNotNull(
                when_?.let { stringResource(R.string.account_session_last_used, it) },
                where,
            ).joinToString(" · ")
            if (meta.isNotEmpty()) {
                Text(
                    meta,
                    style = MaterialTheme.typography.bodySmall,
                    color = KubunoTheme.colors.textTertiary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(CircleShape)
                .clickable(enabled = !busy, onClick = onRevoke),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.AutoMirrored.Outlined.Logout,
                contentDescription = stringResource(R.string.account_session_revoke),
                tint = if (busy) KubunoTheme.colors.textTertiary
                else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

/**
 * Generic account line, 52dp like the drive's settings rows. Without [onClick]
 * it is a plain readout — no ripple, nothing to press.
 */
@Composable
private fun AccountRow(
    label: String,
    value: String? = null,
    danger: Boolean = false,
    icon: ImageVector? = null,
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
        val tint = if (danger) MaterialTheme.colorScheme.error
        else MaterialTheme.colorScheme.onSurface
        if (icon != null) {
            Icon(
                icon,
                contentDescription = null,
                tint = tint,
                modifier = Modifier.size(18.dp),
            )
        }
        Text(
            label,
            fontSize = 15.sp,
            color = tint,
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
private fun LoadingRow() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(52.dp),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
    }
}

/** Failure note under the profile card, with the one action that can fix it. */
@Composable
private fun Notice(message: String, onRetry: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            message,
            style = MaterialTheme.typography.bodySmall,
            color = KubunoTheme.colors.textTertiary,
            modifier = Modifier.weight(1f),
        )
        TextButton(onClick = onRetry) {
            Text(stringResource(R.string.account_retry))
        }
    }
}

private const val EM_DASH = "—"

/** Same fallback the shell avatar uses: up to two initials, else a question mark. */
private fun initialsOf(label: String?): String = label
    ?.split(' ', '@', '.')
    ?.filter { it.isNotBlank() }
    ?.take(2)
    ?.joinToString("") { it.first().uppercase() }
    ?.ifBlank { null }
    ?: "?"

@Composable
private fun roleLabel(role: String?): String = when (role) {
    "admin" -> stringResource(R.string.account_role_admin)
    "user" -> stringResource(R.string.account_role_user)
    "guest" -> stringResource(R.string.account_role_guest)
    else -> role ?: EM_DASH
}

/** `client_type` is 'web' | 'native' | 'desktop' | 'api', or absent. */
@StringRes
private fun clientLabel(clientType: String?): Int = when (clientType) {
    "web" -> R.string.account_client_web
    "native" -> R.string.account_client_native
    "desktop" -> R.string.account_client_desktop
    "api" -> R.string.account_client_api
    else -> R.string.account_client_unknown
}

private val stampFormatter: DateTimeFormatter = DateTimeFormatter.ofPattern("dd MMM yyyy, HH:mm")

/** Session timestamps are ISO-8601 UTC; shown in the phone's own zone. */
private fun formatStamp(iso: String?): String? {
    if (iso == null) return null
    return runCatching {
        Instant.parse(iso)
            .atZone(ZoneId.systemDefault())
            .format(stampFormatter.withLocale(Locale.getDefault()))
    }.getOrNull()
}
