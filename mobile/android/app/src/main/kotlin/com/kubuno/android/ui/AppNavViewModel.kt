package com.kubuno.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkManager
import com.kubuno.android.account.AccountGraphFactory
import com.kubuno.android.account.AccountId
import com.kubuno.android.account.AccountManagerBridge
import com.kubuno.android.account.AccountRecord
import com.kubuno.android.account.AccountRegistry
import com.kubuno.android.sync.work.accountTag
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Owns what is above any single account: which accounts exist, which one the
 * screens show, and signing one out.
 *
 * The per-account screens deliberately know nothing of this — they read their
 * data from `ActiveAccount`, so switching is just a new value in a flow.
 */
@HiltViewModel
class AppNavViewModel @Inject constructor(
    private val registry: AccountRegistry,
    private val graphs: AccountGraphFactory,
    private val bridge: AccountManagerBridge,
    private val workManager: WorkManager,
) : ViewModel() {

    val accounts: StateFlow<List<AccountRecord>> = registry.accounts
    val activeId: StateFlow<AccountId?> = registry.activeId

    fun switchTo(id: AccountId) = registry.setActive(id)

    /**
     * Signs the displayed account out of this device and erases what belongs
     * to it. The other accounts are untouched: their jobs are cancelled by tag,
     * never globally, and their data lives under their own id.
     */
    fun signOutActive() {
        val id = registry.activeId.value ?: return
        val record = registry.get(id) ?: return
        viewModelScope.launch {
            // Revoke server-side first: once the store is erased the refresh
            // token is gone and the session would linger until it expires.
            graphs.graphOf(id)?.let { runCatching { it.client.tokenManager.logout() } }
            workManager.cancelAllWorkByTag(accountTag(id))
            bridge.remove(record)
            registry.remove(id)
            // Closing the database and deleting the caches is disk work.
            withContext(Dispatchers.IO) { graphs.forget(id) }
        }
    }
}
