package com.kubuno.android.ui.onboarding

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kubuno.android.R
import com.kubuno.android.ui.components.KubunoButton
import com.kubuno.android.ui.components.KubunoButtonSize
import com.kubuno.android.ui.components.KubunoButtonVariant
import com.kubuno.android.ui.components.KubunoCallout
import com.kubuno.android.ui.components.KubunoCalloutVariant
import com.kubuno.android.ui.components.KubunoCard
import com.kubuno.android.ui.components.KubunoListRow
import com.kubuno.android.ui.components.KubunoSpinner
import com.kubuno.android.ui.components.KubunoTextField
import com.kubuno.android.ui.shell.Avatar

@Composable
private fun OnboardingColumn(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        content()
    }
}

/**
 * Held while the device's Kubuno accounts are being read, so the server form
 * never flashes before the account list that should replace it.
 */
@Composable
fun OnboardingLoadingScreen() {
    OnboardingColumn { KubunoSpinner() }
}

/**
 * Offers the Kubuno accounts already present on the device instead of asking
 * for a server address, which is all this app can know after its own data was
 * cleared (the system accounts survive that).
 *
 * Picking one only carries over the instance and the e-mail: the password is
 * still asked for on the next screen, because the session behind a system
 * account belongs to the app that signed it in and cannot be handed over — see
 * [OnboardingViewModel.useDeviceAccount].
 */
@Composable
fun DeviceAccountsScreen(viewModel: OnboardingViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    OnboardingColumn {
        Text(
            stringResource(R.string.device_accounts_title),
            style = MaterialTheme.typography.headlineMedium,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            stringResource(R.string.device_accounts_subtitle),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))
        state.serverError?.let {
            KubunoCallout(
                text = stringResource(it),
                variant = KubunoCalloutVariant.DANGER,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
        }
        KubunoCard(modifier = Modifier.fillMaxWidth(), dense = true, flush = true) {
            Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                state.deviceAccounts.forEach { account ->
                    val select = { viewModel.useDeviceAccount(account) }
                    KubunoListRow(
                        title = account.label,
                        subtitle = listOfNotNull(
                            account.email?.takeIf { it != account.label },
                            account.host,
                        ).joinToString(" · "),
                        onClick = select,
                        leading = { Avatar(label = account.label, avatarUrl = null, onClick = select) },
                        trailing = {
                            if (state.serverBusy && state.serverInput == account.serverUrl) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(18.dp),
                                    strokeWidth = 2.dp,
                                )
                            } else {
                                Icon(
                                    Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        },
                    )
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        KubunoButton(
            text = stringResource(R.string.device_accounts_other_server),
            onClick = viewModel::useAnotherServer,
            enabled = !state.serverBusy,
            variant = KubunoButtonVariant.TEXT,
        )
    }
}

@Composable
fun ServerScreen(viewModel: OnboardingViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    OnboardingColumn {
        Text(stringResource(R.string.server_title), style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            stringResource(R.string.server_subtitle),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))
        KubunoTextField(
            value = state.serverInput,
            onValueChange = viewModel::onServerInput,
            modifier = Modifier.fillMaxWidth(),
            placeholder = stringResource(R.string.server_hint),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            error = state.serverError?.let { stringResource(it) },
        )
        Spacer(Modifier.height(16.dp))
        KubunoButton(
            text = stringResource(R.string.server_continue),
            onClick = viewModel::checkServer,
            enabled = !state.serverBusy && state.serverInput.isNotBlank(),
            loading = state.serverBusy,
            size = KubunoButtonSize.LG,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
fun LoginScreen(viewModel: OnboardingViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    // Keyed on the pre-fill so picking a device account seeds the field; the
    // user stays free to correct it.
    var login by rememberSaveable(state.prefillLogin) { mutableStateOf(state.prefillLogin) }
    var password by rememberSaveable { mutableStateOf("") }

    OnboardingColumn {
        Text(stringResource(R.string.login_title), style = MaterialTheme.typography.headlineMedium)
        if (state.serverHost.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Text(
                state.serverHost,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.height(24.dp))
        KubunoTextField(
            value = login,
            onValueChange = { login = it },
            modifier = Modifier.fillMaxWidth(),
            label = stringResource(R.string.login_login_label),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
        )
        Spacer(Modifier.height(12.dp))
        KubunoTextField(
            value = password,
            onValueChange = { password = it },
            modifier = Modifier.fillMaxWidth(),
            label = stringResource(R.string.login_password_label),
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            error = state.loginError?.let { stringResource(it) },
        )
        Spacer(Modifier.height(16.dp))
        KubunoButton(
            text = stringResource(R.string.login_submit),
            onClick = { viewModel.login(login, password) },
            enabled = !state.loginBusy && login.isNotBlank() && password.isNotEmpty(),
            loading = state.loginBusy,
            size = KubunoButtonSize.LG,
            modifier = Modifier.fillMaxWidth(),
        )
        val backToPicker = state.deviceAccounts.isNotEmpty() && !state.deviceAccountsDismissed
        KubunoButton(
            text = stringResource(
                if (backToPicker) R.string.device_accounts_back else R.string.login_change_server
            ),
            onClick = viewModel::resetServer,
            variant = KubunoButtonVariant.TEXT,
        )
    }
}

@Composable
fun TotpScreen(viewModel: OnboardingViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var code by rememberSaveable { mutableStateOf("") }

    OnboardingColumn {
        Text(stringResource(R.string.totp_title), style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            stringResource(R.string.totp_subtitle),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))
        KubunoTextField(
            value = code,
            onValueChange = { code = it.filter(Char::isDigit).take(8) },
            modifier = Modifier.fillMaxWidth(),
            label = stringResource(R.string.totp_code_label),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            error = state.totpError?.let { stringResource(it) },
        )
        Spacer(Modifier.height(16.dp))
        KubunoButton(
            text = stringResource(R.string.totp_submit),
            onClick = { viewModel.verifyTotp(code) },
            enabled = !state.totpBusy && code.length >= 6,
            loading = state.totpBusy,
            size = KubunoButtonSize.LG,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
