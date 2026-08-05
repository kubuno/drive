package com.kubuno.android.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.kubuno.android.R
import com.kubuno.android.api.KubunoClient
import com.kubuno.android.data.AppPrefs
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class HomeUiState(
    val displayName: String? = null,
    val email: String? = null,
    val serverHost: String = "",
    val loggedOut: Boolean = false,
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val client: KubunoClient,
    prefs: AppPrefs,
) : ViewModel() {
    private val _state = MutableStateFlow(
        HomeUiState(
            displayName = prefs.userDisplayName,
            email = prefs.userEmail,
            serverHost = prefs.serverUrl?.removePrefix("https://").orEmpty(),
        )
    )
    val state: StateFlow<HomeUiState> = _state

    fun logout() {
        viewModelScope.launch {
            client.tokenManager.logout()
            _state.value = _state.value.copy(loggedOut = true)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(viewModel: HomeViewModel, onLoggedOut: () -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    if (state.loggedOut) {
        onLoggedOut()
        return
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text(stringResource(R.string.app_name)) }) },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                state.displayName ?: state.email.orEmpty(),
                style = MaterialTheme.typography.headlineSmall,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                stringResource(R.string.home_connected_to, state.serverHost),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(24.dp))
            Text(
                stringResource(R.string.home_drive_soon),
                style = MaterialTheme.typography.bodyLarge,
            )
            Spacer(Modifier.height(32.dp))
            OutlinedButton(onClick = viewModel::logout) {
                Text(stringResource(R.string.home_logout))
            }
        }
    }
}
