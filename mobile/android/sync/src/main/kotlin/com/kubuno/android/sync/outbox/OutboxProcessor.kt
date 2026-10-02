package com.kubuno.android.sync.outbox

import com.kubuno.android.sync.db.OutboxEntity
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * The outbox rows as the drain and the status API see them. Implemented over
 * Room in production ([RoomOutboxStore]) and by an in-memory fake in tests.
 *
 * No method deletes a row except [remove], which is only called for a row that
 * reached the server (or whose goal state already holds) and for an explicit
 * user discard.
 */
interface OutboxStore {
    /** Every row, oldest first. */
    suspend fun all(): List<OutboxEntity>

    suspend fun get(seq: Long): OutboxEntity?

    suspend fun remove(seq: Long)

    /** Keeps the row pending, with its new schedule and last error. */
    suspend fun reschedule(seq: Long, attempts: Int, nextAttemptAt: Long, error: String, errorClass: String)

    /** Moves the row to [OutboxStates.FAILED], keeping it. */
    suspend fun reject(seq: Long, attempts: Int, error: String, errorClass: String)

    /** Back to pending, due now, attempts and error cleared. */
    suspend fun resetToPending(seq: Long)

    /** [resetToPending] for every row that is failed or has failed at least once. */
    suspend fun resetAllToPending()

    /** Earliest `nextAttemptAt` among pending rows, or null when none is pending. */
    suspend fun earliestPendingDue(): Long?
}

/** Result of one pass over the outbox. */
data class PassReport(
    val sent: Int,
    val rescheduled: Int,
    val rejected: Int,
    /** When the drain should run again (epoch ms), or null when nothing is pending. */
    val nextWakeAt: Long?,
)

/**
 * One pass over the outbox, independent of Android so it is unit-testable.
 *
 * Rows are replayed oldest first. A row that is not due yet, or that fails
 * transiently, blocks every later row touching the same items (its target, a
 * move destination, a new folder's parent), so the per-item order of the
 * user's edits is preserved; unrelated rows still go through. Failed rows
 * (definitive refusals) are skipped — they wait for the user — and never block.
 */
class OutboxProcessor(
    private val store: OutboxStore,
    private val clock: () -> Long = System::currentTimeMillis,
    private val jitter: () -> Double = Math::random,
) {
    companion object {
        /** Floor of the next wake-up, so a zero Retry-After cannot spin the worker. */
        const val MIN_WAKE_DELAY_MS = 1_000L
    }

    suspend fun runPass(send: suspend (OutboxEntity) -> SendResult): PassReport {
        var sent = 0
        var rescheduled = 0
        var rejected = 0
        val blocked = HashSet<String>()

        for (entry in store.all()) {
            if (entry.state != OutboxStates.PENDING) continue
            val touches = touchedIds(entry)
            val now = clock()
            if (entry.nextAttemptAt > now || touches.any { it in blocked }) {
                blocked += touches
                continue
            }

            val result = send(entry)
            when (val decision = OutboxPolicy.decide(entry.op, entry.attempts, result, now, jitter())) {
                Decision.Remove -> {
                    store.remove(entry.seq)
                    sent++
                }
                is Decision.Retry -> {
                    store.reschedule(
                        entry.seq,
                        decision.attempts,
                        decision.nextAttemptAt,
                        decision.error,
                        decision.errorClass.wire,
                    )
                    rescheduled++
                    blocked += touches
                    if (decision.stopPass) break
                }
                is Decision.Reject -> {
                    store.reject(entry.seq, decision.attempts, decision.error, decision.errorClass.wire)
                    rejected++
                }
            }
        }

        val due = store.earliestPendingDue()
        val nextWake = due?.let { maxOf(it, clock() + MIN_WAKE_DELAY_MS) }
        return PassReport(sent, rescheduled, rejected, nextWake)
    }

    private val json = Json { ignoreUnknownKeys = true }

    /** Ids whose state this row depends on or changes. */
    private fun touchedIds(entry: OutboxEntity): Set<String> {
        val ids = HashSet<String>()
        entry.targetId?.let(ids::add)
        val payload = runCatching { json.parseToJsonElement(entry.payload) as? JsonObject }.getOrNull()
        for (key in listOf("target", "parent")) {
            (payload?.get(key) as? JsonPrimitive)?.contentOrNull?.let(ids::add)
        }
        return ids
    }
}
