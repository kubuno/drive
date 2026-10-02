package com.kubuno.android.sync.outbox

import androidx.room.withTransaction
import com.kubuno.android.sync.Ops
import com.kubuno.android.sync.db.KubunoDatabase
import com.kubuno.android.sync.db.OutboxEntity
import com.kubuno.android.sync.db.OutboxIssueRow
import com.kubuno.android.sync.work.SyncScheduler
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/** How a not-synced intent is shown. */
enum class NotSyncedState {
    /** Refused by the server: waits for the user to retry or discard it. */
    REJECTED,

    /** Still retried automatically, but it has failed many times. */
    RETRYING,
}

/** One local change that has not reached the server. */
data class NotSyncedIntent(
    /** The outbox row (`seq`); pass it to retry/discard. */
    val id: Long,
    /** rename | move | trash | restore | star | mkdir ([Ops]). */
    val op: String,
    val targetId: String?,
    val isFolder: Boolean,
    /** Name of the item, when the local tree still knows it. */
    val targetName: String?,
    val state: NotSyncedState,
    val attempts: Int,
    val lastError: String?,
    val errorClass: HttpClass?,
    /** Next automatic attempt (epoch ms) for a [NotSyncedState.RETRYING] row. */
    val nextAttemptAt: Long,
    val createdAt: Long,
    /** For a star intent: the value asked for (true = add to starred). */
    val starred: Boolean? = null,
)

/** The not-synced intents of an account. */
data class NotSyncedSummary(val items: List<NotSyncedIntent> = emptyList()) {
    val count: Int get() = items.size
    val rejected: Int get() = items.count { it.state == NotSyncedState.REJECTED }
    val retrying: Int get() = items.count { it.state == NotSyncedState.RETRYING }
}

/** Undoes the optimistic local edit of a discarded row. */
fun interface LocalRollback {
    suspend fun undo(entry: OutboxEntity)
}

/**
 * The user's actions on not-synced intents, over an [OutboxStore] — no Android
 * dependency, so the state transitions are unit-testable with fakes.
 */
class OutboxController(
    private val store: OutboxStore,
    private val rollback: LocalRollback,
) {
    /** Back to pending, due now, attempts reset. False when the row is gone. */
    suspend fun retryNow(id: Long): Boolean {
        store.get(id) ?: return false
        store.resetToPending(id)
        return true
    }

    /** [retryNow] for every row that failed at least once or was refused. */
    suspend fun retryAll() = store.resetAllToPending()

    /**
     * The only way a not-synced change leaves the outbox without reaching the
     * server: the row is deleted and the local edit rolled back.
     *
     * The rollback only runs when no later row touches the same item: a later
     * edit is what the user sees now and will still reach the server, so
     * restoring the value from before this one would be wrong. A discarded
     * folder creation is always undone (the folder never existed remotely).
     */
    suspend fun discard(id: Long): Boolean {
        val all = store.all()
        val entry = all.firstOrNull { it.seq == id } ?: return false
        store.remove(id)
        val superseded = entry.targetId != null &&
            all.any { it.seq > entry.seq && it.targetId == entry.targetId }
        if (entry.op == Ops.MKDIR || !superseded) rollback.undo(entry)
        return true
    }
}

/**
 * Rolls a discarded edit back in the local tree, from the row's payload. Rows
 * queued before `prev_name` / `prev_parent` existed cannot undo a rename or a
 * move; the next change of that item in the delta restores it.
 */
class RoomLocalRollback(private val db: KubunoDatabase) : LocalRollback {
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun undo(entry: OutboxEntity) {
        val id = entry.targetId ?: return
        val payload = runCatching { json.parseToJsonElement(entry.payload) as? JsonObject }.getOrNull()
            ?: JsonObject(emptyMap())
        val folders = db.folderDao()
        val files = db.fileDao()
        when (entry.op) {
            Ops.RENAME -> payload.text("prev_name")?.let { prev ->
                if (entry.isFolder) folders.rename(id, prev) else files.rename(id, prev)
            }
            Ops.MOVE -> if (payload.containsKey("prev_parent")) {
                val prev = payload.text("prev_parent")
                if (entry.isFolder) folders.move(id, prev) else files.move(id, prev)
            }
            Ops.TRASH -> if (entry.isFolder) folders.setTrashed(id, false) else files.setTrashed(id, false)
            Ops.RESTORE -> if (entry.isFolder) folders.setTrashed(id, true) else files.setTrashed(id, true)
            Ops.STAR -> (payload["starred"] as? JsonPrimitive)?.booleanOrNull?.let { starred ->
                if (entry.isFolder) folders.setStarred(id, !starred) else files.setStarred(id, !starred)
            }
            Ops.MKDIR -> folders.delete(id)
        }
    }

    private fun JsonObject.text(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeUnless { it is JsonNull }?.contentOrNull
}

/**
 * The user-facing side of an account's outbox: which changes are not synced,
 * and the retry / discard actions. Surfaced by the apps' sync banner.
 */
class OutboxStatus(
    private val db: KubunoDatabase,
    private val scheduler: SyncScheduler,
) {
    private val controller = OutboxController(RoomOutboxStore(db.outboxDao()), RoomLocalRollback(db))

    /**
     * Refused intents, plus pending ones that failed at least
     * [OutboxPolicy.SURFACE_AFTER_ATTEMPTS] times.
     */
    val notSynced: Flow<NotSyncedSummary> = db.outboxDao()
        .notSynced(OutboxPolicy.SURFACE_AFTER_ATTEMPTS)
        .map { rows -> NotSyncedSummary(rows.map { it.toIntent() }) }

    /** Retries one intent at once: back to pending, attempts reset. */
    suspend fun retryNow(id: Long) {
        if (controller.retryNow(id)) scheduler.syncNow()
    }

    /** Retries every not-synced intent at once. */
    suspend fun retryAll() {
        controller.retryAll()
        scheduler.syncNow()
    }

    /** Drops the intent and rolls its local change back. */
    suspend fun discard(id: Long) {
        val removed = db.withTransaction { controller.discard(id) }
        // The pull reconciles whatever the server holds for the item.
        if (removed) scheduler.syncNow()
    }
}

private val issueJson = Json { ignoreUnknownKeys = true }

private fun OutboxIssueRow.toIntent(): NotSyncedIntent {
    val fields = runCatching { issueJson.parseToJsonElement(payload) as? JsonObject }.getOrNull()
    val fallbackName = if (op == Ops.MKDIR) (fields?.get("name") as? JsonPrimitive)?.contentOrNull else null
    val starred = if (op == Ops.STAR) (fields?.get("starred") as? JsonPrimitive)?.booleanOrNull else null
    return NotSyncedIntent(
        id = seq,
        op = op,
        targetId = targetId,
        isFolder = isFolder,
        targetName = targetName ?: fallbackName,
        state = if (state == OutboxStates.FAILED) NotSyncedState.REJECTED else NotSyncedState.RETRYING,
        attempts = attempts,
        lastError = lastError,
        errorClass = HttpClass.fromWire(lastErrorClass),
        nextAttemptAt = nextAttemptAt,
        createdAt = createdAt,
        starred = starred,
    )
}
