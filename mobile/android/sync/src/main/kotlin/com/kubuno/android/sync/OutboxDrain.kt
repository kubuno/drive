package com.kubuno.android.sync

import android.util.Log
import com.kubuno.android.api.KubunoClient
import com.kubuno.android.api.model.CreateFolderRequest
import com.kubuno.android.api.model.MoveRequest
import com.kubuno.android.api.model.RenameRequest
import com.kubuno.android.sync.db.KubunoDatabase
import com.kubuno.android.sync.db.OutboxEntity
import java.io.IOException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.Response

/**
 * Replays queued mutations, oldest first, before the delta pull.
 *
 * A transient failure (network, 5xx, 429) stops the drain and leaves the entry
 * in place; WorkManager retries later. A definitive rejection drops the entry —
 * keeping it would block every later mutation behind a request that can never
 * succeed — and the following delta pull restores the server's truth over the
 * optimistic local edit.
 */
class OutboxDrain(
    private val db: KubunoDatabase,
    private val client: KubunoClient,
) {
    companion object {
        private const val TAG = "KubunoOutbox"
        private const val MAX_ATTEMPTS = 5
    }

    private val json = Json

    /** Throws [IOException] on a transient failure so the worker retries. */
    suspend fun drain() {
        for (entry in db.outboxDao().pending()) {
            val outcome = runCatching { send(entry) }.getOrElse { error ->
                if (error is IOException) throw error else Outcome.DEFINITIVE
            }
            when (outcome) {
                Outcome.DONE -> db.outboxDao().remove(entry.seq)
                Outcome.DEFINITIVE -> {
                    Log.w(TAG, "dropping ${entry.op} on ${entry.targetId}: rejected by server")
                    db.outboxDao().remove(entry.seq)
                }
                Outcome.TRANSIENT -> {
                    db.outboxDao().markFailed(entry.seq, "transient")
                    if (entry.attempts + 1 >= MAX_ATTEMPTS) {
                        Log.w(TAG, "giving up on ${entry.op} after ${entry.attempts + 1} attempts")
                        db.outboxDao().remove(entry.seq)
                    }
                    throw IOException("outbox entry ${entry.seq} needs a retry")
                }
            }
        }
    }

    private enum class Outcome { DONE, DEFINITIVE, TRANSIENT }

    private suspend fun send(entry: OutboxEntity): Outcome {
        val api = client.driveApi
        val id = entry.targetId ?: return Outcome.DEFINITIVE
        val payload = json.decodeFromString(JsonObject.serializer(), entry.payload)
        val key = entry.idempotencyKey

        val response: Response<*> = when (entry.op) {
            Ops.RENAME -> {
                val body = RenameRequest(name = payload.str("name") ?: return Outcome.DEFINITIVE)
                if (entry.isFolder) api.renameFolder(id, body, key) else api.renameFile(id, body, key)
            }

            Ops.MOVE -> {
                val target = payload.str("target")
                if (entry.isFolder) api.moveFolder(id, MoveRequest(parentId = target), key)
                else api.moveFile(id, MoveRequest(folderId = target), key)
            }

            // A trashed item that is already gone server-side is the goal state.
            Ops.TRASH ->
                if (entry.isFolder) api.trashFolder(id, key) else api.trashFile(id, key)

            Ops.RESTORE ->
                if (entry.isFolder) api.restoreFolder(id, key) else api.restoreFile(id, key)

            Ops.STAR -> return sendStar(entry, id, key, payload)

            Ops.MKDIR -> api.createFolder(
                CreateFolderRequest(
                    name = payload.str("name") ?: return Outcome.DEFINITIVE,
                    parentId = payload.str("parent"),
                    id = id,
                ),
                key,
            )

            else -> return Outcome.DEFINITIVE
        }

        return classify(response, treat404AsSuccess = entry.op == Ops.TRASH)
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
    ): Outcome {
        val desired = payload["starred"]?.jsonPrimitive?.boolean ?: return Outcome.DEFINITIVE
        val api = client.driveApi
        val response = if (entry.isFolder) api.toggleFolderStar(id, key) else api.toggleFileStar(id, key)
        if (!response.isSuccessful) return classify(response, treat404AsSuccess = false)

        val actual = if (entry.isFolder) {
            (response.body() as? com.kubuno.android.api.model.FolderEnvelope)?.folder?.isStarred
        } else {
            (response.body() as? com.kubuno.android.api.model.FileEnvelope)?.file?.isStarred
        }
        // One extra toggle when the first landed on the wrong side. A distinct
        // key is required: replaying the first would return its cached response.
        if (actual != null && actual != desired) {
            val second = if (entry.isFolder) api.toggleFolderStar(id, "$key-2")
            else api.toggleFileStar(id, "$key-2")
            return classify(second, treat404AsSuccess = false)
        }
        return Outcome.DONE
    }

    private fun classify(response: Response<*>, treat404AsSuccess: Boolean): Outcome = when {
        response.isSuccessful -> Outcome.DONE
        response.code() == 404 && treat404AsSuccess -> Outcome.DONE
        response.code() == 429 || response.code() >= 500 -> Outcome.TRANSIENT
        else -> Outcome.DEFINITIVE
    }
}

private fun JsonObject.str(key: String): String? =
    this[key]?.jsonPrimitive?.let { if (it.content == "null") null else it.content }
