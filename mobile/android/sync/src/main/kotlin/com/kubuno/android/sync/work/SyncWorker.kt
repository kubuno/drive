package com.kubuno.android.sync.work

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.kubuno.android.api.auth.AuthException
import com.kubuno.android.api.auth.FailureKind
import com.kubuno.android.sync.SyncEngine
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val engine: SyncEngine,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = try {
        engine.pull()
        Result.success()
    } catch (e: AuthException) {
        // Genuine: the session is dead, re-login is a user action — do not spin.
        if (e.kind == FailureKind.GENUINE) Result.failure() else Result.retry()
    } catch (e: IOException) {
        if (runAttemptCount >= 3) Result.failure() else Result.retry()
    }
}

/** Enqueues the unique sync work; safe to call from any trigger, any thread. */
@Singleton
class SyncScheduler @Inject constructor(
    private val workManager: WorkManager,
) {
    fun syncNow() {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(
                Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            )
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        // APPEND_OR_REPLACE, not KEEP: a sync already running has read the delta
        // up to its own cursor, so a change arriving mid-run would be dropped
        // and never pulled until some later trigger. Queueing behind it costs
        // one cheap request (the cursor is current) and cannot lose a change.
        workManager.enqueueUniqueWork(
            "drive-sync",
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            request,
        )
    }
}
