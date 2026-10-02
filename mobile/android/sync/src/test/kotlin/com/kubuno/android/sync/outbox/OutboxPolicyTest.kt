package com.kubuno.android.sync.outbox

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OutboxPolicyTest {
    private val now = 1_000_000L

    private fun decide(result: SendResult, op: String = "rename", attempts: Int = 0) =
        OutboxPolicy.decide(op, attempts, result, now, jitterUnit = 0.5)

    @Test
    fun `success removes the row`() {
        assertEquals(Decision.Remove, decide(SendResult.Success))
    }

    @Test
    fun `transient answers keep the row with the backoff`() {
        for (status in listOf(408, 425, 500, 502, 503, 599)) {
            val d = decide(SendResult.Http(status), attempts = 2) as Decision.Retry
            assertEquals(3, d.attempts)
            assertEquals(now + 8_000, d.nextAttemptAt)
            assertEquals(HttpClass.TRANSIENT, d.errorClass)
            assertFalse("status $status", d.stopPass)
        }
        val inProgress = decide(SendResult.Http(409, "IN_PROGRESS")) as Decision.Retry
        assertEquals(HttpClass.TRANSIENT, inProgress.errorClass)
        assertEquals(now + 2_000, inProgress.nextAttemptAt)
    }

    @Test
    fun `a rate limit honours Retry-After and stops the pass`() {
        val d = decide(SendResult.Http(429, retryAfterMs = 30_000), attempts = 7) as Decision.Retry
        assertEquals(now + 30_000, d.nextAttemptAt)
        assertTrue(d.stopPass)
        val capped = decide(SendResult.Http(503, retryAfterMs = 86_400_000)) as Decision.Retry
        assertEquals(now + OutboxPolicy.MAX_DELAY_MS, capped.nextAttemptAt)
    }

    @Test
    fun `network failures are transient and stop the pass`() {
        val d = decide(SendResult.Network("timeout")) as Decision.Retry
        assertEquals(HttpClass.TRANSIENT, d.errorClass)
        assertTrue(d.stopPass)
        assertTrue(d.error.contains("timeout"))
    }

    @Test
    fun `an intent is never given up`() {
        for (attempts in listOf(5, 50, 10_000, Int.MAX_VALUE - 1)) {
            val d = OutboxPolicy.decide("rename", attempts, SendResult.Http(503), now, 1.0)
            assertTrue("attempts $attempts", d is Decision.Retry)
            d as Decision.Retry
            assertTrue(d.nextAttemptAt - now <= (OutboxPolicy.MAX_DELAY_MS * 1.2).toLong())
        }
    }

    @Test
    fun `unparseable and unexpected answers retry as protocol errors`() {
        val unparseable = decide(SendResult.Unparseable("bad json")) as Decision.Retry
        assertEquals(HttpClass.PROTOCOL, unparseable.errorClass)
        val redirect = decide(SendResult.Http(302)) as Decision.Retry
        assertEquals(HttpClass.PROTOCOL, redirect.errorClass)
        val cursor = decide(SendResult.Http(410, "CURSOR_EXPIRED")) as Decision.Retry
        assertEquals(HttpClass.PROTOCOL, cursor.errorClass)
    }

    @Test
    fun `401 keeps the row and stops the pass`() {
        val d = decide(SendResult.Http(401)) as Decision.Retry
        assertEquals(HttpClass.UNAUTHORIZED, d.errorClass)
        assertTrue(d.stopPass)
    }

    @Test
    fun `definitive refusals move the row to failed`() {
        for ((status, code) in listOf(400 to null, 403 to null, 413 to null, 422 to "VALIDATION",
            409 to "IDEMPOTENCY_KEY_REUSED", 409 to "IDEMPOTENCY_MISMATCH")) {
            val d = decide(SendResult.Http(status, code), attempts = 1) as Decision.Reject
            assertEquals(2, d.attempts)
            assertEquals(HttpClass.DEFINITIVE, d.errorClass)
            assertTrue(d.error.contains(status.toString()))
        }
        val invalid = decide(SendResult.Invalid("unknown operation x")) as Decision.Reject
        assertEquals(HttpClass.DEFINITIVE, invalid.errorClass)
    }

    @Test
    fun `conflicts are kept for the user`() {
        assertEquals(HttpClass.CONFLICT, (decide(SendResult.Http(409)) as Decision.Reject).errorClass)
        assertEquals(HttpClass.CONFLICT, (decide(SendResult.Http(412)) as Decision.Reject).errorClass)
    }

    @Test
    fun `not found completes a trash but is kept for other operations`() {
        assertEquals(Decision.Remove, decide(SendResult.Http(404), op = "trash"))
        assertEquals(Decision.Remove, decide(SendResult.Http(410), op = "trash"))
        val rename = decide(SendResult.Http(404), op = "rename") as Decision.Reject
        assertEquals(HttpClass.NOT_FOUND, rename.errorClass)
    }

    @Test
    fun `backoff clamps a jitter outside the unit interval`() {
        assertEquals(1_600L, OutboxPolicy.backoffMs(0, null, -3.0))
        assertEquals(2_400L, OutboxPolicy.backoffMs(0, null, 7.0))
        assertEquals(0L, OutboxPolicy.backoffMs(0, -5L, 0.5))
    }

    @Test
    fun `Retry-After parses seconds and HTTP dates`() {
        assertEquals(120_000L, OutboxPolicy.parseRetryAfterMs("120", 0))
        assertEquals(
            5_000L,
            OutboxPolicy.parseRetryAfterMs("Wed, 21 Oct 2015 07:28:05 GMT", 1_445_412_480_000L),
        )
        assertEquals(0L, OutboxPolicy.parseRetryAfterMs("Wed, 21 Oct 2015 07:28:00 GMT", 1_445_412_490_000L))
        assertNull(OutboxPolicy.parseRetryAfterMs(null, 0))
        assertNull(OutboxPolicy.parseRetryAfterMs("soon", 0))
        assertNull(OutboxPolicy.parseRetryAfterMs("-1", 0))
    }

    @Test
    fun `error codes are read from the API envelopes`() {
        assertEquals("IN_PROGRESS", OutboxPolicy.parseErrorCode("""{"error":"IN_PROGRESS","message":"x"}"""))
        assertEquals("CURSOR_EXPIRED", OutboxPolicy.parseErrorCode("""{"error":{"code":"CURSOR_EXPIRED"}}"""))
        assertEquals("VALIDATION", OutboxPolicy.parseErrorCode("""{"code":"VALIDATION"}"""))
        assertNull(OutboxPolicy.parseErrorCode("<html>502</html>"))
        assertNull(OutboxPolicy.parseErrorCode(""))
        assertNull(OutboxPolicy.parseErrorCode(null))
    }
}
