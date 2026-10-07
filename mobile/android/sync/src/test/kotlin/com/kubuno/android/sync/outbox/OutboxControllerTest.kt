package com.kubuno.android.sync.outbox

import com.kubuno.android.sync.db.OutboxEntity
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OutboxControllerTest {
    private val undone = mutableListOf<Long>()
    private val rollback = LocalRollback { undone += it.seq }

    private fun controller(store: OutboxStore) = OutboxController(store, rollback)

    @Test
    fun `retryNow puts a failed row back to pending, due now, attempts reset`() = runBlocking {
        val store = FakeOutboxStore(listOf(outboxRow(1, state = OutboxStates.FAILED, attempts = 3)))
        assertTrue(controller(store).retryNow(1))
        val row = store.row(1)!!
        assertEquals(OutboxStates.PENDING, row.state)
        assertEquals(0, row.attempts)
        assertEquals(0L, row.nextAttemptAt)
        assertNull(row.lastError)
        assertFalse(controller(store).retryNow(42))
    }

    @Test
    fun `retryNow makes a backed-off row due at once`() = runBlocking {
        val store = FakeOutboxStore(listOf(outboxRow(1, attempts = 9, nextAttemptAt = Long.MAX_VALUE)))
        controller(store).retryNow(1)
        assertEquals(0L, store.row(1)!!.nextAttemptAt)
        assertEquals(0, store.row(1)!!.attempts)
    }

    @Test
    fun `retryAll resets every failed or failing row and nothing else`() = runBlocking {
        val untouched = outboxRow(3)
        val store = FakeOutboxStore(
            listOf(
                outboxRow(1, state = OutboxStates.FAILED, attempts = 1),
                outboxRow(2, attempts = 6, nextAttemptAt = 99),
                untouched,
            )
        )
        controller(store).retryAll()
        assertTrue(store.rows.all { it.state == OutboxStates.PENDING && it.attempts == 0 && it.nextAttemptAt == 0L })
        assertEquals(untouched, store.row(3))
        assertTrue(store.removed.isEmpty())
    }

    @Test
    fun `discard deletes the row and rolls the local change back`() = runBlocking {
        val store = FakeOutboxStore(listOf(outboxRow(1, state = OutboxStates.FAILED), outboxRow(2, target = "other")))
        assertTrue(controller(store).discard(1))
        assertEquals(listOf(1L), store.removed)
        assertEquals(listOf(1L), undone)
        assertEquals(listOf(2L), store.rows.map { it.seq })
        assertFalse(controller(store).discard(1))
    }

    @Test
    fun `discard does not undo an edit superseded by a later one`() = runBlocking {
        val store = FakeOutboxStore(listOf(outboxRow(1, target = "a"), outboxRow(2, target = "a")))
        controller(store).discard(1)
        assertTrue(undone.isEmpty())
        assertEquals(listOf(2L), store.rows.map { it.seq })
    }

    @Test
    fun `a discarded folder creation is always undone`() = runBlocking {
        val store = FakeOutboxStore(
            listOf(
                outboxRow(1, op = "mkdir", target = "new", isFolder = true, payload = """{"name":"N","parent":null}"""),
                outboxRow(2, target = "new", isFolder = true),
            )
        )
        controller(store).discard(1)
        assertEquals(listOf(1L), undone)
    }

    @Test
    fun `nothing is deleted without an explicit discard`() = runBlocking {
        var now = 0L
        val store = FakeOutboxStore(
            listOf(outboxRow(1, target = "a"), outboxRow(2, target = "b"), outboxRow(3, target = "c"))
        )
        val processor = OutboxProcessor(store, clock = { now }, jitter = { 0.5 })
        val answers = mapOf(1L to SendResult.Http(403), 2L to SendResult.Http(409), 3L to SendResult.Http(404))
        repeat(5) {
            processor.runPass { entry: OutboxEntity -> answers.getValue(entry.seq) }
            controller(store).retryAll()
            now += 1_000_000
        }
        assertEquals(listOf(1L, 2L, 3L), store.rows.map { it.seq })
        assertTrue(store.removed.isEmpty())
        assertTrue(undone.isEmpty())
    }
}
