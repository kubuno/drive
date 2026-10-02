package com.kubuno.android.sync

import android.util.Log
import com.kubuno.android.api.KubunoClient
import com.kubuno.android.api.auth.AuthException
import com.kubuno.android.api.model.CreateFolderRequest
import com.kubuno.android.api.model.FileEnvelope
import com.kubuno.android.api.model.FolderEnvelope
import com.kubuno.android.api.model.MoveRequest
import com.kubuno.android.api.model.RenameRequest
import com.kubuno.android.sync.db.KubunoDatabase
import com.kubuno.android.sync.db.OutboxEntity
import com.kubuno.android.sync.outbox.OutboxPolicy
import com.kubuno.android.sync.outbox.OutboxProcessor
import com.kubuno.android.sync.outbox.PassReport
import com.kubuno.android.sync.outbox.RoomOutboxStore
import com.kubuno.android.sync.outbox.SendResult
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.Response

/**
 * Replays queued mutations, oldest first, before the delta pull.
 *
 * Decision Q5 (SHARED-CORES.md): an intent is never given up.
 *  - A transient failure (network, timeout, 408/425/429, 5xx, 409 IN_PROGRESS,
 *    unparseable answer) keeps the row pending with a capped, jittered backoff
 *    persisted on the row ([OutboxPolicy.backoffMs]); the drain skips rows not
 *    yet due and reports when it should run again, and the caller arms a
 *    WorkManager wake-up for that time. WorkManager's own retry counter and
 *    backoff are not part of the policy.
 *  - A definitive refusal moves the row to "failed": kept, shown to the user
 *    as not synced, until they retry or discard it ([com.kubuno.android.sync.outbox.OutboxStatus]).
 *
 * Nothing is deleted here except rows the server accepted (or whose goal state
 * already holds, such as trashing an item that is gone).
 */
class OutboxDrain(
    private val db: KubunoDatabase,
    private val client: KubunoClient,
) {
    companion object {
        private const val TAG = "KubunoOutbox"
    }

    private val json = Json

    /**
     * One pass over the outbox. Never throws for a failed row (the failure is
     * recorded on it); [AuthException] and cancellation propagate.
     */
    suspend fun drain(): PassReport {
        val report = OutboxProcessor(RoomOutboxStore(db.outboxDao())).runPass(::attempt)
        if (report.rescheduled > 0 || report.rejected > 0) {
            Log.i(
                TAG,
                "outbox pass: sent=${report.sent} rescheduled=${report.rescheduled} " +
                    "rejected=${report.rejected} nextWakeAt=${report.nextWakeAt}",
            )
        }
        return report
    }

    private suspend fun attempt(entry: OutboxEntity): SendResult = try {
        send(entry)
    } catch (e: CancellationException) {
        throw e
    } catch (e: AuthException) {
        throw e
    } catch (e: IOException) {
        SendResult.Network(e.message ?: e.javaClass.simpleName)
    } catch (e: Exception) {
        // A response we could not read (converter failure on a success body…).
        SendResult.Unparseable(e.message ?: e.javaClass.simpleName)
    }

    private suspend fun send(entry: OutboxEntity): SendResult {
        val api = client.driveApi
        val id = entry.targetId ?: return SendResult.Invalid("no target")
        val payload = runCatching { json.decodeFromString(JsonObject.serializer(), entry.payload) }
            .getOrNull() ?: return SendResult.Invalid("unreadable payload")
        val key = entry.idempotencyKey

        val response: Response<*> = when (entry.op) {
            Ops.RENAME -> {
                val body = RenameRequest(name = payload.str("name") ?: return SendResult.Invalid("rename without a name"))
                if (entry.isFolder) api.renameFolder(id, body, key) else api.renameFile(id, body, key)
            }

            Ops.MOVE -> {
                val target = payload.str("target")
                if (entry.isFolder) api.moveFolder(id, MoveRequest(parentId = target), key)
                else api.moveFile(id, MoveRequest(folderId = target), key)
            }

            // A trashed item that is already gone server-side is the goal
            // state: the policy turns its not_found into a success.
            Ops.TRASH ->
                if (entry.isFolder) api.trashFolder(id, key) else api.trashFile(id, key)

            Ops.RESTORE ->
                if (entry.isFolder) api.restoreFolder(id, key) else api.restoreFile(id, key)

            Ops.STAR -> return sendStar(entry, id, key, payload)

            Ops.MKDIR -> api.createFolder(
                CreateFolderRequest(
                    name = payload.str("name") ?: return SendResult.Invalid("mkdir without a name"),
                    parentId = payload.str("parent"),
                    id = id,
                ),
                key,
            )

            else -> return SendResult.Invalid("unknown operation ${entry.op}")
        }

        return response.toSendResult()
    }

    /**
     * The server only offers a toggle, so we read the current state first and
     * call only when it differs. Without that check a replay would flip the
     * star back to where the user did not want it.
     */
    private suspend fun sendStar(
        entry: OutboxEntity,
        id: String,
        key: String,
        payload: JsonObject,
    ): SendResult {
        val desired = payload["starred"]?.jsonPrimitive?.booleanOrNull
            ?: return SendResult.Invalid("star without a value")
        val api = client.driveApi
        val response = if (entry.isFolder) api.toggleFolderStar(id, key) else api.toggleFileStar(id, key)
        if (!response.isSuccessful) return response.toSendResult()

        val actual = if (entry.isFolder) {
            (response.body() as? FolderEnvelope)?.folder?.isStarred
        } else {
            (response.body() as? FileEnvelope)?.file?.isStarred
        }
        // One extra toggle when the first landed on the wrong side. A distinct
        // key is required: replaying the first would return its cached response.
        if (actual != null && actual != desired) {
            val second = if (entry.isFolder) api.toggleFolderStar(id, "$key-2")
            else api.toggleFileStar(id, "$key-2")
            return second.toSendResult()
        }
        return SendResult.Success
    }

    private fun Response<*>.toSendResult(): SendResult {
        if (isSuccessful) return SendResult.Success
        val body = runCatching { errorBody()?.string() }.getOrNull()
        return SendResult.Http(
            status = code(),
            code = OutboxPolicy.parseErrorCode(body),
            retryAfterMs = OutboxPolicy.parseRetryAfterMs(headers()["Retry-After"], System.currentTimeMillis()),
        )
    }
}

private fun JsonObject.str(key: String): String? =
    this[key]?.jsonPrimitive?.let { if (it.content == "null") null else it.content }
