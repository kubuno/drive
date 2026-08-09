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
    }

    override fun onStop(owner: LifecycleOwner) {
        events.stop()
    }
}
