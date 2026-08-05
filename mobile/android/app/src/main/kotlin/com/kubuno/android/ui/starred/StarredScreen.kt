package com.kubuno.android.ui.starred

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Star
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kubuno.android.R
import com.kubuno.android.api.KubunoClient
import com.kubuno.android.sync.db.FileEntity
import com.kubuno.android.sync.db.KubunoDatabase
import com.kubuno.android.ui.browser.FileRow
import com.kubuno.android.ui.browser.ListContainer
import com.kubuno.android.ui.browser.TabEmptyState
import com.kubuno.android.ui.sheet.FileInfoSheet
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn

@HiltViewModel
class StarredViewModel @Inject constructor(
    db: KubunoDatabase,
    private val client: KubunoClient,
) : ViewModel() {
    val files: StateFlow<List<FileEntity>> = db.fileDao().starred()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val serverBaseUrl: String? get() = client.serverBaseUrl()
}

/** Starred files come straight from the local store, so this tab works offline. */
@Composable
fun StarredScreen(viewModel: StarredViewModel) {
    val files by viewModel.files.collectAsStateWithLifecycle()
    var sheet by remember { mutableStateOf<FileEntity?>(null) }

    if (files.isEmpty()) {
        TabEmptyState(
            icon = Icons.Outlined.Star,
            message = stringResource(R.string.empty_starred),
            hint = stringResource(R.string.empty_starred_hint),
        )
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 12.dp),
    ) {
        item {
            ListContainer {
                files.forEachIndexed { index, file ->
                    FileRow(
                        file = file,
                        baseUrl = viewModel.serverBaseUrl,
                        zebra = index % 2 == 0,
                        onOpen = { sheet = file },
                        onMenu = { sheet = file },
                    )
                }
            }
        }
    }

    sheet?.let { FileInfoSheet(file = it, onDismiss = { sheet = null }) }
}
