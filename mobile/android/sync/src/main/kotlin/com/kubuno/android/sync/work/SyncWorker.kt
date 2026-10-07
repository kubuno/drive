package com.kubuno.android.sync.work

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.kubuno.android.account.AccountGraphFactory
import com.kubuno.android.account.AccountId
import com.kubuno.android.api.auth.AuthException
import com.kubuno.android.api.auth.FailureKind
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Input key carrying which account a job belongs to. */
const val KEY_ACCOUNT_ID = "accountId"

/** Tag applied to every job of an account, so removing it can cancel them all. */
fun accountTag(id: AccountId) = "account:${id.value}"

/**
 * Pushes an account's queued mutations, pulls its delta, then reconciles its
 * offline copies.
 *
 * Dependencies arrive before the worker can read its input, so it injects the
 * graph factory and resolves the account itself — injecting a graph directly
 * would silently bind every job to whichever account was current.
 */
@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val graphs: AccountGraphFactory,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val id = inputData.getString(KEY_ACCOUNT_ID)?.let(::AccountId) ?: return Result.failure()
        val graph = graphs.graphOf(id) ?: return Result.failure()
        return try {
            // Push before pull, so local edits reach the server before the delta
            // that would otherwise overwrite them.
            //
            // The drain never fails for a row: each failure is recorded on the
            // row with its own backoff, and the report says when the next row
            // is due. That wake-up is armed here, so the outbox schedule never
            // depends on this worker's retry counter or WorkManager's backoff.
            val outbox = graph.outbox.drain()
            graph.scheduler.wakeOutboxAt(outbox.nextWakeAt)
            // Rows still waiting do not hold the pull back: an intent that keeps
            // failing would otherwise freeze the whole tree.
            graph.engine.pull()
            // The pull is what reveals a server-side edit, so pinned copies are
            // reconciled right after it.
            runCatching { graph.offline.refresh() }
            Result.success()
        } catch (e: AuthException) {
            // Genuine: the session is dead, re-login is a user action — do not spin.
            if (e.kind == FailureKind.GENUINE) Result.failure() else Result.retry()
        } catch (e: IOException) {
            // Only the pull gets here (the outbox keeps its own schedule), and
            // the next trigger pulls again from the persisted cursor.
            if (runAttemptCount >= 3) Result.failure() else Result.retry()
        }
    }
}

/**
 * Fires when the earliest pending outbox row becomes due and queues a normal
 * sync of the account behind any sync already running. It never touches the
 * outbox itself, so two drains of one account never run side by side.
 */
@HiltWorker
class OutboxWakeWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val graphs: AccountGraphFactory,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val id = inputData.getString(KEY_ACCOUNT_ID)?.let(::AccountId) ?: return Result.success()
        graphs.graphOf(id)?.scheduler?.syncNow()
        return Result.success()
    }
}

/** Enqueues the unique sync work of one account; safe from any thread. */
class SyncScheduler(
    private val workManager: WorkManager,
    private val accountId: AccountId,
) {
    fun syncNow() {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(
                Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            )
            .setInputData(Data.Builder().putString(KEY_ACCOUNT_ID, accountId.value).build())
            .addTag(accountTag(accountId))
            .build()
        // APPEND_OR_REPLACE, not KEEP: a sync already running has read the delta
        // up to its own cursor, so a change arriving mid-run would be dropped
        // and never pulled until some later trigger. Queueing behind it costs
        // one cheap request (the cursor is current) and cannot lose a change.
        workManager.enqueueUniqueWork(
            workName(accountId),
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            request,
        )
    }

    /**
     * Arms (or, with null, cancels) the wake-up for the next due outbox row.
     * [atEpochMs] is persisted on the rows themselves; this is only the alarm,
     * and a later pass re-arms it from the database.
     */
    fun wakeOutboxAt(atEpochMs: Long?) {
        if (atEpochMs == null) {
            workManager.cancelUniqueWork(wakeName(accountId))
            return
        }
        val delay = (atEpochMs - System.currentTimeMillis()).coerceAtLeast(0L)
        val request = OneTimeWorkRequestBuilder<OutboxWakeWorker>()
            .setInitialDelay(delay, TimeUnit.MILLISECONDS)
            .setConstraints(
                Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            )
            .setInputData(Data.Builder().putString(KEY_ACCOUNT_ID, accountId.value).build())
            .addTag(accountTag(accountId))
            .build()
        workManager.enqueueUniqueWork(wakeName(accountId), ExistingWorkPolicy.REPLACE, request)
    }

    companion object {
        /** Per-account name: two accounts must never serialise behind each other. */
        fun workName(id: AccountId) = "drive-sync:${id.value}"

        /** Per-account name of the outbox wake-up alarm. */
        fun wakeName(id: AccountId) = "drive-outbox-wake:${id.value}"
    }
}
