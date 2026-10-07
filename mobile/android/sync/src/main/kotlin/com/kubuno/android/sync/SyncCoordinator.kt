package com.kubuno.android.sync

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle.State
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.WorkManager
import com.kubuno.android.account.AccountGraph
import com.kubuno.android.account.AccountGraphFactory
import com.kubuno.android.account.AccountRegistry
import com.kubuno.android.sync.work.AutoUploadWorker
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Drives the sync triggers for **every** account, not just the one on screen.
 *
 * Which account the UI shows is a view concern; a background account must keep
 * syncing, uploading its camera roll and hearing server events, otherwise
 * switching to it would present stale data and its photos would wait for a
 * visit that may never come.
 */
@Singleton
class SyncCoordinator @Inject constructor(
    private val registry: AccountRegistry,
    private val graphs: AccountGraphFactory,
    private val workManager: WorkManager,
) : DefaultLifecycleObserver {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** Accounts already running, so a registry change only starts the new ones. */
    private val started = mutableSetOf<String>()

    /** Idempotent; call once from Application.onCreate. */
    fun install() {
        ProcessLifecycleOwner.get().lifecycle.addObserver(this)
        // Content-URI triggers fire once and do not survive a reboot, so every
        // account re-arms its own each time the process starts.
        graphs.all().forEach { AutoUploadWorker.schedule(workManager, it.id, it.prefs) }
        // An account signed into while the app is already open would otherwise
        // wait for the next foreground transition to get its socket and its
        // camera-roll trigger.
        // On Main because the lifecycle state and [started] are read there too.
        scope.launch(Dispatchers.Main) {
            registry.accounts.collect {
                if (ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(State.STARTED)) {
                    startAll()
                }
            }
        }
    }

    override fun onStart(owner: LifecycleOwner) = startAll()

    private fun startAll() {
        graphs.all().forEach { graph ->
            if (!graph.client.tokenManager.isLoggedIn()) return@forEach
            if (!started.add(graph.id.value)) return@forEach
            AutoUploadWorker.schedule(workManager, graph.id, graph.prefs)
            graph.scheduler.syncNow()
            graph.events.start { graph.scheduler.syncNow() }
            refreshProfile(graph)
        }
    }

    override fun onStop(owner: LifecycleOwner) {
        // Sockets are a foreground luxury; WorkManager keeps the rest alive.
        graphs.all().forEach { it.events.stop() }
        started.clear()
    }

    /**
     * Refreshes a cached profile. The login response is a snapshot: a display
     * name or avatar changed elsewhere would otherwise stay stale for the life
     * of the session.
     */
    private fun refreshProfile(graph: AccountGraph) {
        scope.launch {
            runCatching { graph.client.authApi.me() }
                .getOrNull()
                ?.takeIf { it.isSuccessful }
                ?.body()
                ?.user
                ?.let { user ->
                    registry.updateProfile(
                        id = graph.id,
                        displayName = user.displayName ?: user.username,
                        email = user.email,
                        avatarPath = user.avatarUrl,
                    )
                }
        }
    }
}
