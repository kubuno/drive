package com.kubuno.android.sync.outbox

import com.kubuno.android.sync.db.OutboxEntity
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** In-memory [OutboxStore]: the same transitions as the Room DAO. */
internal class FakeOutboxStore(rows: List<OutboxEntity> = emptyList()) : OutboxStore {
    val rows = rows.toMutableList()
    val removed = mutableListOf<Long>()

    fun row(seq: Long): OutboxEntity? = rows.firstOrNull { it.seq == seq }

    private fun update(seq: Long, change: (OutboxEntity) -> OutboxEntity) {
        val i = rows.indexOfFirst { it.seq == seq }
        if (i >= 0) rows[i] = change(rows[i])
    }

    override suspend fun all() = rows.sortedBy { it.seq }
    override suspend fun get(seq: Long) = row(seq)
    override suspend fun remove(seq: Long) {
        if (rows.removeAll { it.seq == seq }) removed += seq
    }

    override suspend fun reschedule(seq: Long, attempts: Int, nextAttemptAt: Long, error: String, errorClass: String) =
        update(seq) {
            it.copy(state = OutboxStates.PENDING, attempts = attempts, nextAttemptAt = nextAttemptAt,
                lastError = error, lastErrorClass = errorClass)
        }

    override suspend fun reject(seq: Long, attempts: Int, error: String, errorClass: String) =
        update(seq) { it.copy(state = OutboxStates.FAILED, attempts = attempts, lastError = error, lastErrorClass = errorClass) }

    override suspend fun resetToPending(seq: Long) =
        update(seq) {
            it.copy(state = OutboxStates.PENDING, attempts = 0, nextAttemptAt = 0, lastError = null, lastErrorClass = null)
        }

    override suspend fun resetAllToPending() {
        rows.filter { it.state == OutboxStates.FAILED || it.attempts > 0 }.forEach { resetToPending(it.seq) }
    }

    override suspend fun earliestPendingDue(): Long? =
        rows.filter { it.state == OutboxStates.PENDING }.minOfOrNull { it.nextAttemptAt }
}

internal fun outboxRow(
    seq: Long,
    op: String = "rename",
    target: String = "item-$seq",
    payload: String = """{"name":"n$seq","prev_name":"old$seq"}""",
    isFolder: Boolean = false,
    state: String = OutboxStates.PENDING,
    attempts: Int = 0,
    nextAttemptAt: Long = 0,
) = OutboxEntity(
    seq = seq,
    idempotencyKey = "key-$seq",
    op = op,
    targetId = target,
    isFolder = isFolder,
    payload = payload,
    attempts = attempts,
    createdAt = seq,
    state = state,
    nextAttemptAt = nextAttemptAt,
)

class OutboxProcessorTest {
    private var now = 10_000_000L

    private fun processor(store: OutboxStore) = OutboxProcessor(store, clock = { now }, jitter = { 0.5 })

    @Test
    fun `a sent row leaves the outbox`() = runBlocking {
        val store = FakeOutboxStore(listOf(outboxRow(1), outboxRow(2)))
        val report = processor(store).runPass { SendResult.Success }
        assertEquals(2, report.sent)
        assertTrue(store.rows.isEmpty())
        assertNull(report.nextWakeAt)
    }

    @Test
    fun `a transient failure keeps the row and schedules it`() = runBlocking {
        val store = FakeOutboxStore(listOf(outboxRow(1, attempts = 3)))
        val report = processor(store).runPass { SendResult.Http(503) }
        val row = store.row(1)!!
        assertEquals(OutboxStates.PENDING, row.state)
        assertEquals(4, row.attempts)
        assertEquals(now + 16_000, row.nextAttemptAt)
        assertEquals("transient", row.lastErrorClass)
        assertEquals("HTTP 503", row.lastError)
        assertEquals(now + 16_000, report.nextWakeAt)
        assertTrue(store.removed.isEmpty())
    }

    @Test
    fun `rows not yet due are skipped and set the next wake-up`() = runBlocking {
        val store = FakeOutboxStore(listOf(outboxRow(1, nextAttemptAt = now + 60_000)))
        var calls = 0
        val report = processor(store).runPass { calls++; SendResult.Success }
        assertEquals(0, calls)
        assertEquals(now + 60_000, report.nextWakeAt)
        assertEquals(store.rows.single(), store.row(1))
    }

    @Test
    fun `a due row is sent once its time has come`() = runBlocking {
        val store = FakeOutboxStore(listOf(outboxRow(1, attempts = 4, nextAttemptAt = now - 1)))
        processor(store).runPass { SendResult.Success }
        assertTrue(store.rows.isEmpty())
    }

    @Test
    fun `a definitive refusal keeps the row as failed and the pass goes on`() = runBlocking {
        val store = FakeOutboxStore(listOf(outboxRow(1), outboxRow(2)))
        val report = processor(store).runPass { if (it.seq == 1L) SendResult.Http(400) else SendResult.Success }
        assertEquals(1, report.rejected)
        assertEquals(1, report.sent)
        val failed = store.row(1)!!
        assertEquals(OutboxStates.FAILED, failed.state)
        assertEquals("definitive", failed.lastErrorClass)
        assertEquals(listOf(2L), store.removed)
        // A failed row waits for the user: no wake-up for it.
        assertNull(report.nextWakeAt)
    }

    @Test
    fun `failed rows are never retried automatically nor deleted`() = runBlocking {
        val store = FakeOutboxStore(listOf(outboxRow(1, state = OutboxStates.FAILED, attempts = 1)))
        var calls = 0
        repeat(10) {
            processor(store).runPass { calls++; SendResult.Success }
            now += 3_600_000
        }
        assertEquals(0, calls)
        assertEquals(OutboxStates.FAILED, store.row(1)!!.state)
        assertTrue(store.removed.isEmpty())
    }

    @Test
    fun `a transient row is retried forever and never dropped`() = runBlocking {
        val store = FakeOutboxStore(listOf(outboxRow(1)))
        repeat(200) {
            processor(store).runPass { SendResult.Http(500) }
            now = store.row(1)!!.nextAttemptAt
        }
        val row = store.row(1)!!
        assertEquals(200, row.attempts)
        assertEquals(OutboxStates.PENDING, row.state)
        assertTrue(store.removed.isEmpty())
    }

    @Test
    fun `a blocked row holds back later rows on the same item only`() = runBlocking {
        val store = FakeOutboxStore(
            listOf(
                outboxRow(1, target = "a"),
                outboxRow(2, target = "a"),
                outboxRow(3, target = "b"),
                // Moves "c" into "a": depends on "a" as well.
                outboxRow(4, op = "move", target = "c", payload = """{"target":"a"}"""),
            )
        )
        val sent = mutableListOf<Long>()
        processor(store).runPass {
            sent += it.seq
            if (it.seq == 1L) SendResult.Http(502) else SendResult.Success
        }
        assertEquals(listOf(1L, 3L), sent)
        assertEquals(listOf(1L, 2L, 4L), store.rows.map { it.seq })
    }

    @Test
    fun `a network failure stops the pass`() = runBlocking {
        val store = FakeOutboxStore(listOf(outboxRow(1, target = "a"), outboxRow(2, target = "b")))
        val sent = mutableListOf<Long>()
        processor(store).runPass { sent += it.seq; SendResult.Network("unreachable") }
        assertEquals(listOf(1L), sent)
        assertEquals(1, store.row(1)!!.attempts)
        assertEquals(0, store.row(2)!!.attempts)
    }

    @Test
    fun `the next wake-up is never in the past`() = runBlocking {
        val store = FakeOutboxStore(listOf(outboxRow(1)))
        val report = processor(store).runPass { SendResult.Http(429, retryAfterMs = 0) }
        assertEquals(now + OutboxProcessor.MIN_WAKE_DELAY_MS, report.nextWakeAt)
        assertFalse(store.rows.isEmpty())
    }
}
