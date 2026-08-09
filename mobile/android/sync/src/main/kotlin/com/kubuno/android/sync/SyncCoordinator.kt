package com.kubuno.android.sync

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.WorkManager
import com.kubuno.android.api.KubunoClient
import com.kubuno.android.data.AppPrefs
import com.kubuno.android.sync.realtime.DriveEventsClient
import com.kubuno.android.sync.work.AutoUploadWorker
import com.kubuno.android.sync.work.SyncScheduler
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Wires the sync triggers to the app lifecycle: on foreground, sync once and
 * hold the realtime socket open; on background, close it (WorkManager keeps
 * covering mutations; push wakes us later — M5).
 */
@Singleton
class SyncCoordinator @Inject constructor(
    private val client: KubunoClient,
    private val scheduler: SyncScheduler,
    private val events: DriveEventsClient,
    private val workManager: WorkManager,
    private val prefs: AppPrefs,
) : DefaultLifecycleObserver {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** Idempotent; call once from Application.onCreate. */
    fun install() {
        ProcessLifecycleOwner.get().lifecycle.addObserver(this)
        // A content-URI trigger fires once and does not survive a reboot, so
        // it is re-armed every time the process starts.
        AutoUploadWorker.schedule(workManager, prefs)
    }

    override fun onStart(owner: LifecycleOwner) {
        if (!client.tokenManager.isLoggedIn()) return
        scheduler.syncNow()
        events.start { scheduler.syncNow() }
        refreshProfile()
    }

    /**
     * Refreshes the cached profile on every foreground. The login response is
     * a snapshot: a display name or avatar changed elsewhere would otherwise
     * stay stale for the life of the session.
     */
    private fun refreshProfile() {
        scope.launch {
            runCatching { client.authApi.me() }
                .getOrNull()
                ?.takeIf { it.isSuccessful }
                ?.body()
                ?.user
                ?.let { user ->
                    prefs.userDisplayName = user.displayName ?: user.username
                    prefs.userEmail = user.email
                    prefs.userAvatarUrl = user.avatarUrl
                }
        }
    }

    override fun onStop(owner: LifecycleOwner) {
        events.stop()
    }
}
