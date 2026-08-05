package com.kubuno.android.ui.onboarding

import android.os.Build
import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kubuno.android.BuildConfig
import com.kubuno.android.R
import com.kubuno.android.api.KubunoClient
import com.kubuno.android.api.auth.LoginOutcome
import com.kubuno.android.api.model.DeclareDeviceRequest
import com.kubuno.android.data.AppPrefs
import dagger.hilt.android.lifecycle.HiltViewModel
import java.io.IOException
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class OnboardingUiState(
    val serverInput: String = "",
    val serverBusy: Boolean = false,
    @param:StringRes val serverError: Int? = null,
    val serverValidated: Boolean = false,

    val loginBusy: Boolean = false,
    @param:StringRes val loginError: Int? = null,

    val totpSession: String? = null,
    val totpBusy: Boolean = false,
    @param:StringRes val totpError: Int? = null,

    /** True once a session is established — navigate to home. */
    val done: Boolean = false,
)

@HiltViewModel
class OnboardingViewModel @Inject constructor(
    val client: KubunoClient,
    private val prefs: AppPrefs,
) : ViewModel() {

    private val _state = MutableStateFlow(
        OnboardingUiState(serverInput = prefs.serverUrl?.removePrefix("https://") ?: "")
    )
    val state: StateFlow<OnboardingUiState> = _state

    fun onServerInput(value: String) {
        _state.update { it.copy(serverInput = value, serverError = null) }
    }

    fun checkServer() {
        val input = _state.value.serverInput.trim()
        if (input.isEmpty()) return
        _state.update { it.copy(serverBusy = true, serverError = null) }
        viewModelScope.launch {
            val normalized = KubunoClient.normalize(input)
            val reachable = try {
                client.setServer(normalized)
                client.authApi.health().isSuccessful
            } catch (e: IOException) {
                false
            } catch (e: IllegalArgumentException) {
                false // unparseable URL
            }
            if (reachable) {
                prefs.serverUrl = normalized
                _state.update { it.copy(serverBusy = false, serverValidated = true) }
            } else {
                _state.update {
                    it.copy(serverBusy = false, serverError = R.string.server_error_unreachable)
                }
            }
        }
    }

    /** Back from login to the server screen (also used by "change server"). */
    fun resetServer() {
        _state.update { it.copy(serverValidated = false, loginError = null, totpSession = null) }
    }

    fun login(loginText: String, password: String) {
        if (loginText.isBlank() || password.isEmpty()) return
        _state.update { it.copy(loginBusy = true, loginError = null) }
        viewModelScope.launch {
            val outcome = client.tokenManager.login(
                login = loginText.trim(),
                password = password,
                deviceName = deviceName(),
            )
            handleOutcome(outcome, isTotpStep = false)
        }
    }

    fun verifyTotp(code: String) {
        val session = _state.value.totpSession ?: return
        if (code.isBlank()) return
        _state.update { it.copy(totpBusy = true, totpError = null) }
        viewModelScope.launch {
            val outcome = client.tokenManager.verifyTotp(code.trim(), session)
            handleOutcome(outcome, isTotpStep = true)
        }
    }

    private suspend fun handleOutcome(outcome: LoginOutcome, isTotpStep: Boolean) {
        when (outcome) {
            is LoginOutcome.Success -> {
                prefs.userDisplayName = outcome.user?.displayName ?: outcome.user?.username
                prefs.userEmail = outcome.user?.email
                declareDevice()
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

    /** Best-effort device inventory declaration; failures are irrelevant to login. */
    private suspend fun declareDevice() {
        runCatching {
            client.authApi.declareDevice(
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
