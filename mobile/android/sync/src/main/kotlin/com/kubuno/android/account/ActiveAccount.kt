package com.kubuno.android.account

import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

/**
 * The account the screens are currently showing.
 *
 * Only the view follows this: every registered account keeps syncing and
 * uploading in the background, so switching changes what is displayed, not
 * what is running.
 */
@Singleton
class ActiveAccount @Inject constructor(
    private val registry: AccountRegistry,
    private val graphs: AccountGraphFactory,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /** Null while no account is registered — the app is then in onboarding. */
    val graph: StateFlow<AccountGraph?> =
        combine(registry.activeId, registry.accounts) { id, _ -> id?.let(graphs::graphOf) }
            .stateIn(scope, SharingStarted.Eagerly, registry.activeId.value?.let(graphs::graphOf))

    val record: AccountRecord? get() = graph.value?.record

    fun switchTo(id: AccountId) = registry.setActive(id)
}
