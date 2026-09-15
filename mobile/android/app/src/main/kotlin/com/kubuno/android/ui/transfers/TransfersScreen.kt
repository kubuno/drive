package com.kubuno.android.ui.transfers

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.SwapVert
import androidx.compose.material.icons.outlined.Upload
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.kubuno.android.R
import com.kubuno.android.account.AccountGraph
import com.kubuno.android.account.ActiveAccount
import com.kubuno.android.sync.db.TransferEntity
import com.kubuno.android.ui.browser.ListContainer
import com.kubuno.android.ui.browser.TabEmptyState
import com.kubuno.android.ui.format.SizeUnits
import com.kubuno.android.ui.format.formatSize
import com.kubuno.android.ui.components.KubunoProgressBar
import com.kubuno.android.ui.theme.KubunoTheme
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Shows only the displayed account's queue — the other accounts keep
 * transferring in the background, their rows just belong to their own screen.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class TransfersViewModel @Inject constructor(
    active: ActiveAccount,
) : ViewModel() {

    private val graph: StateFlow<AccountGraph?> = active.graph

    val transfers: StateFlow<List<TransferEntity>> = graph
        .flatMapLatest { g -> g?.transfers?.all() ?: flowOf(emptyList()) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private fun withGraph(block: suspend (AccountGraph) -> Unit) {
        val g = graph.value ?: return
        viewModelScope.launch { block(g) }
    }

    fun retry(id: Long) = withGraph { it.transfers.retry(id) }
    fun clearFinished() = withGraph { it.transfers.clearFinished() }
}

@Composable
fun TransfersScreen(viewModel: TransfersViewModel) {
    val transfers by viewModel.transfers.collectAsStateWithLifecycle()

    if (transfers.isEmpty()) {
        TabEmptyState(icon = Icons.Outlined.SwapVert, message = stringResource(R.string.transfers_empty))
        return
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp),
            horizontalArrangement = Arrangement.End,
        ) {
            TextButton(onClick = { viewModel.clearFinished() }) {
                Text(stringResource(R.string.transfer_clear))
            }
        }
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 24.dp, vertical = 4.dp),
        ) {
            item {
                ListContainer {
                    transfers.forEach { transfer ->
                        TransferRow(transfer, onRetry = { viewModel.retry(transfer.id) })
                    }
                }
            }
        }
    }
}

@Composable
private fun TransferRow(transfer: TransferEntity, onRetry: () -> Unit) {
    val units = SizeUnits(
        byte = stringResource(R.string.unit_byte),
        kb = stringResource(R.string.unit_kb),
        mb = stringResource(R.string.unit_mb),
        gb = stringResource(R.string.unit_gb),
    )
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            if (transfer.kind == "upload") Icons.Outlined.Upload else Icons.Outlined.Download,
            contentDescription = null,
            tint = when (transfer.state) {
                "failed" -> MaterialTheme.colorScheme.error
                "done" -> KubunoTheme.colors.success
                else -> MaterialTheme.colorScheme.primary
            },
            modifier = Modifier.size(24.dp),
        )
        Column(Modifier.weight(1f)) {
            Text(
                transfer.name,
                fontSize = 15.sp,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            val stateLabel = stringResource(
                when (transfer.state) {
                    "running" -> R.string.state_running
                    "done" -> R.string.state_done
                    "failed" -> R.string.state_failed
                    else -> R.string.state_queued
                }
            )
            Text(
                "$stateLabel · ${formatSize(transfer.bytesDone, units)} / ${formatSize(transfer.totalSize, units)}",
                style = MaterialTheme.typography.bodySmall,
                color = KubunoTheme.colors.textTertiary,
                maxLines = 1,
            )
            if (transfer.state == "running" || transfer.state == "queued") {
                Spacer(Modifier.height(6.dp))
                val fraction = if (transfer.totalSize > 0) {
                    (transfer.bytesDone.toFloat() / transfer.totalSize).coerceIn(0f, 1f)
                } else 0f
                KubunoProgressBar(
                    progress = fraction,
                    modifier = Modifier.fillMaxWidth(),
                    showValue = false,
                )
            }
        }
        if (transfer.state == "failed") {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clickable(onClick = onRetry),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Outlined.Refresh,
                    contentDescription = stringResource(R.string.transfer_retry),
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
    }
}
