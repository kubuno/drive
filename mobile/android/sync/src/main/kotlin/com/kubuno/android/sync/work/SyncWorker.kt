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
            graph.outbox.drain()
            graph.engine.pull()
            // The pull is what reveals a server-side edit, so pinned copies are
            // reconciled right after it.
            runCatching { graph.offline.refresh() }
            Result.success()
        } catch (e: AuthException) {
            // Genuine: the session is dead, re-login is a user action — do not spin.
            if (e.kind == FailureKind.GENUINE) Result.failure() else Result.retry()
        } catch (e: IOException) {
            if (runAttemptCount >= 3) Result.failure() else Result.retry()
        }
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

    companion object {
        /** Per-account name: two accounts must never serialise behind each other. */
        fun workName(id: AccountId) = "drive-sync:${id.value}"
    }
}
