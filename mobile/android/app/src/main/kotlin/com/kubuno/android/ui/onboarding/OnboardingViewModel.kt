package com.kubuno.android.ui.onboarding

import android.content.Context
import android.os.Build
import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kubuno.android.BuildConfig
import com.kubuno.android.R
import com.kubuno.android.account.AccountGraphFactory
import com.kubuno.android.account.AccountId
import com.kubuno.android.account.AccountRegistry
import com.kubuno.android.account.AccountClients
import com.kubuno.android.account.SharedAccount
import com.kubuno.android.account.SharedAccounts
import com.kubuno.android.api.KubunoClient
import com.kubuno.android.api.auth.LoginOutcome
import com.kubuno.android.api.auth.TokenManager
import com.kubuno.android.api.model.DeclareDeviceRequest
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.IOException
import java.util.UUID
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class OnboardingUiState(
    val serverInput: String = "",
    val serverBusy: Boolean = false,
    @param:StringRes val serverError: Int? = null,
    val serverValidated: Boolean = false,

    /** Kubuno accounts already on the device that this app has not registered. */
    val deviceAccounts: List<SharedAccount> = emptyList(),
    /** True until [deviceAccounts] has been read, so no screen is picked too early. */
    val deviceAccountsLoading: Boolean = true,
    /** True once the user chose "use another server" over the listed accounts. */
    val deviceAccountsDismissed: Boolean = false,

    /** Identifier to start the login screen with, taken from a device account. */
    val prefillLogin: String = "",
    /** Host being signed into, shown on the login screen. Empty before the probe. */
    val serverHost: String = "",

    val loginBusy: Boolean = false,
    @param:StringRes val loginError: Int? = null,

    val totpSession: String? = null,
    val totpBusy: Boolean = false,
    @param:StringRes val totpError: Int? = null,

    /** True once the account is registered — leave onboarding. */
    val done: Boolean = false,
)

/**
 * Signs into one instance and registers the result as an account.
 *
 * Re-entrant on purpose: it is the same flow whether the device has no account
 * yet or the user is adding a second one. Nothing global is mutated on the way
 * — the probe and the sign-in run against a throwaway client bound to the URL
 * being tried, so a typo cannot re-point the accounts already in use.
 */
@HiltViewModel
class OnboardingViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val registry: AccountRegistry,
    private val graphs: AccountGraphFactory,
    private val clients: AccountClients,
    private val sharedAccounts: SharedAccounts,
) : ViewModel() {

    private val _state = MutableStateFlow(OnboardingUiState())
    val state: StateFlow<OnboardingUiState> = _state

    /** Client for the instance being signed into, rebuilt at each attempt. */
    private var pending: PendingSignIn? = null

    private class PendingSignIn(
        val accountId: AccountId,
        val serverUrl: String,
        val client: KubunoClient,
    ) {
        val tokens: TokenManager get() = client.tokenManager
    }

    init {
        viewModelScope.launch { loadDeviceAccounts() }
    }

    /**
     * Lists the Kubuno accounts the device already knows about and that this
     * app has not registered — typically after its data was cleared, since the
     * system accounts outlive it, or when a sibling app signed one in.
     *
     * Why they are offered as a PRE-FILL and not as a silent "adoption": drive
     * owns the authenticator, and a session's refresh token never leaves the
     * app that obtained it — the server rotates it on every use and revokes the
     * whole family if two processes rotate at once. Running instead as a
     * brokered consumer (BrokeredClients / KubunoTokenProvider) would only
     * borrow 15-minute access tokens, and only while some sibling app still
     * holds a live session for that identity; after a data wipe of this app
     * nothing usually does, and drive's sync engine, uploads and background
     * workers all need an owned session that survives on their own. So the
     * account's non-secret half (instance, e-mail) is reused and only the
     * password is asked for, which re-establishes a real owned session — and
     * AccountManagerBridge then re-adopts the existing system entry instead of
     * creating a second one.
     */
    private suspend fun loadDeviceAccounts() {
        val known = registry.accounts.value.mapTo(mutableSetOf()) { identityKey(it.serverUrl, it.userId) }
        val candidates = withContext(Dispatchers.IO) {
            runCatching { sharedAccounts.list() }.getOrDefault(emptyList())
        }.filterNot { identityKey(it.serverUrl, it.userId) in known }
        _state.update { it.copy(deviceAccounts = candidates, deviceAccountsLoading = false) }
    }

    private fun identityKey(serverUrl: String, userId: String): String =
        "${serverUrl.trimEnd('/').lowercase()}|$userId"

    /** Starts the sign-in on an account already present on the device. */
    fun useDeviceAccount(account: SharedAccount) {
        if (_state.value.serverBusy) return
        _state.update {
            it.copy(
                serverInput = account.serverUrl,
                serverError = null,
                prefillLogin = account.email.orEmpty(),
            )
        }
        checkServer()
    }

    /** Leaves the device-account list for the plain "type an address" flow. */
    fun useAnotherServer() {
        _state.update {
            it.copy(
                deviceAccountsDismissed = true,
                serverInput = "",
                serverError = null,
                prefillLogin = "",
            )
        }
    }

    fun onServerInput(value: String) {
        _state.update { it.copy(serverInput = value, serverError = null) }
    }

    fun checkServer() {
        val input = _state.value.serverInput.trim()
        if (input.isEmpty()) return
        _state.update { it.copy(serverBusy = true, serverError = null) }
        viewModelScope.launch {
            val url = KubunoClient.normalize(input)
            // The id is minted here so the token store already has a home if
            // the sign-in succeeds; an abandoned attempt leaves nothing behind
            // but an unused empty file.
            val candidate = AccountId(UUID.randomUUID().toString())
            val client = clients.probe(url, candidate)
            val reachable = try {
                client.authApi.health().isSuccessful
            } catch (e: IOException) {
                false
            } catch (e: IllegalArgumentException) {
                false // unparseable URL
            }
            if (reachable) {
                pending = PendingSignIn(candidate, url, client)
                _state.update {
                    it.copy(serverBusy = false, serverValidated = true, serverHost = hostOf(url))
                }
            } else {
                client.shutdown()
                _state.update {
                    it.copy(serverBusy = false, serverError = R.string.server_error_unreachable)
                }
            }
        }
    }

    /** Back from login to the server screen (also used by "change server"). */
    fun resetServer() {
        pending?.client?.shutdown()
        pending = null
        _state.update {
            it.copy(
                serverValidated = false,
                loginError = null,
                totpSession = null,
                prefillLogin = "",
                serverHost = "",
            )
        }
    }

    private fun hostOf(url: String): String =
        url.removePrefix("https://").removePrefix("http://").substringBefore('/')

    fun login(loginText: String, password: String) {
        val attempt = pending ?: return
        if (loginText.isBlank() || password.isEmpty()) return
        _state.update { it.copy(loginBusy = true, loginError = null) }
        viewModelScope.launch {
            val outcome = attempt.tokens.login(
                login = loginText.trim(),
                password = password,
                deviceName = deviceName(),
            )
            handleOutcome(attempt, outcome, isTotpStep = false)
        }
    }

    fun verifyTotp(code: String) {
        val attempt = pending ?: return
        val session = _state.value.totpSession ?: return
        if (code.isBlank()) return
        _state.update { it.copy(totpBusy = true, totpError = null) }
        viewModelScope.launch {
            val outcome = attempt.tokens.verifyTotp(code.trim(), session)
            handleOutcome(attempt, outcome, isTotpStep = true)
        }
    }

    private suspend fun handleOutcome(
        attempt: PendingSignIn,
        outcome: LoginOutcome,
        isTotpStep: Boolean,
    ) {
        when (outcome) {
            is LoginOutcome.Success -> {
                val user = outcome.user
                if (user == null) {
                    _state.update { it.copy(loginBusy = false, totpBusy = false, loginError = R.string.login_error_server) }
                    return
                }
                // Signing into an account already on the device reuses its id,
                // so its local data stays attached instead of being orphaned.
                val record = registry.upsert(
                    serverUrl = attempt.serverUrl,
                    userId = user.id,
                    email = user.email,
                    displayName = user.displayName ?: user.username,
                    avatarPath = user.avatarUrl,
                )
                if (record.id != attempt.accountId) {
                    // Move the freshly stored tokens onto the existing id.
                    clients.store(attempt.accountId).load()?.let { tokens ->
                        clients.store(record.id).save(tokens)
                    }
                    clients.store(attempt.accountId).clear()
                }
                declareDevice(attempt)
                attempt.client.shutdown()
                pending = null
                registry.setActive(record.id)
                graphs.graphOf(record.id)?.scheduler?.syncNow()
                _state.update { it.copy(loginBusy = false, totpBusy = false, done = true) }
            }

            is LoginOutcome.TotpRequired -> {
                _state.update {
                    it.copy(loginBusy = false, totpBusy = false, totpSession = outcome.totpSession)
                }
            }

            is LoginOutcome.Failure -> {
                val message = when {
                    outcome.httpCode == null -> R.string.login_error_network
                    outcome.httpCode in listOf(400, 401, 403, 422) ->
                        if (isTotpStep) R.string.totp_error else R.string.login_error_credentials
                    else -> R.string.login_error_server
                }
                _state.update {
                    if (isTotpStep) it.copy(totpBusy = false, totpError = message)
                    else it.copy(loginBusy = false, loginError = message)
                }
            }
        }
    }

    /** Resets the flow so it can be reused to add another account. */
    fun restart() {
        pending?.client?.shutdown()
        pending = null
        _state.value = OnboardingUiState()
        // The account just signed in is no longer a candidate, and a sibling
        // app may have published a new one meanwhile.
        viewModelScope.launch { loadDeviceAccounts() }
    }

    /** Best-effort device inventory declaration; failures are irrelevant to login. */
    private suspend fun declareDevice(attempt: PendingSignIn) {
        runCatching {
            attempt.client.authApi.declareDevice(
                DeclareDeviceRequest(
                    platform = "android",
                    platformVersion = Build.VERSION.RELEASE,
                    appVersion = BuildConfig.VERSION_NAME,
                )
            )
        }
    }

    private fun deviceName(): String {
        val model = Build.MODEL.orEmpty()
        val manufacturer = Build.MANUFACTURER.orEmpty()
        return when {
            model.startsWith(manufacturer, ignoreCase = true) -> model
            else -> "$manufacturer $model"
        }.trim().ifEmpty { "Android" }
    }
}
