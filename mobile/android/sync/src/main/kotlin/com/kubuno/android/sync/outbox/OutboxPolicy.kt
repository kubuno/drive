package com.kubuno.android.sync.outbox

import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import kotlin.math.roundToLong
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * Class of an HTTP answer to a sync request (shared conformance suite
 * `sync.http.classify`). [wire] is the string the shared vectors use.
 */
enum class HttpClass(val wire: String) {
    /** Retry later with the same idempotency key; never give up. */
    TRANSIENT("transient"),

    /** The server will never accept this request: kept, shown as not synced. */
    DEFINITIVE("definitive"),

    /** Run the conflict policy (409 without a known code, 412). */
    CONFLICT("conflict"),

    /** The target is gone (404, 410 without CURSOR_EXPIRED). */
    NOT_FOUND("not_found"),

    /** 401 after the client's single refresh attempt. */
    UNAUTHORIZED("unauthorized"),

    /** The delta cursor is too old: reset the feed. */
    CURSOR_EXPIRED("cursor_expired"),

    /** Unexpected answer: retried like transient but surfaced as an error. */
    PROTOCOL("protocol");

    companion object {
        fun fromWire(value: String?): HttpClass? = entries.firstOrNull { it.wire == value }
    }
}

/** Persistent state of an outbox row, stored in `outbox.state`. */
object OutboxStates {
    /** Waiting for its next attempt (at `nextAttemptAt`). */
    const val PENDING = "pending"

    /**
     * Definitively refused by the server. The row is kept and shown as "not
     * synced" until the user retries or discards it; it is never retried
     * automatically and never deleted without an explicit discard.
     */
    const val FAILED = "failed"
}

/** What one attempt at sending an outbox row produced. */
sealed interface SendResult {
    /** The server applied the change (or it already was the goal state). */
    data object Success : SendResult

    /** An HTTP answer that is not a success. */
    data class Http(val status: Int, val code: String? = null, val retryAfterMs: Long? = null) : SendResult

    /** No answer at all: connection refused, timeout, DNS, TLS… */
    data class Network(val message: String?) : SendResult

    /** An answer came back but could not be understood (unparseable body…). */
    data class Unparseable(val message: String?) : SendResult

    /**
     * The row itself can never be sent (unknown operation, malformed payload).
     * Retrying cannot help, so it is a definitive failure.
     */
    data class Invalid(val reason: String) : SendResult
}

/** What to do with a row after an attempt. */
sealed interface Decision {
    /** Done: the row leaves the outbox. */
    data object Remove : Decision

    /**
     * Keep the row pending and try again at [nextAttemptAt].
     * [stopPass] asks the drain to stop for now: the failure (network down,
     * session refused, rate limit) would hit every following row too.
     */
    data class Retry(
        val attempts: Int,
        val nextAttemptAt: Long,
        val error: String,
        val errorClass: HttpClass,
        val stopPass: Boolean,
    ) : Decision

    /** Move the row to the persistent "not synced" state; it stays in the database. */
    data class Reject(val attempts: Int, val error: String, val errorClass: HttpClass) : Decision
}

/**
 * The outbox policy, free of any Android dependency so it is unit-testable and
 * checked against the shared conformance vectors (`sync.outbox.backoff`,
 * `sync.http.classify`). Decision Q5 of SHARED-CORES.md: an intent is never
 * given up; definitive refusals are kept and surfaced to the user.
 */
object OutboxPolicy {
    const val BASE_DELAY_MS = 2_000L
    const val MAX_DELAY_MS = 900_000L
    const val MAX_EXPONENT = 20
    const val JITTER = 0.2

    /**
     * From this many failed attempts a still-pending row is surfaced to the
     * user as "not synced yet, retrying", with a manual retry.
     */
    const val SURFACE_AFTER_ATTEMPTS = 5

    /**
     * Delay before the next attempt after a transient failure.
     *
     * base = min(2^clamp(attempts, 0, 20) x 2000 ms, 900000 ms), then
     * round(base x (1 + 0.2 x (2u - 1))) for a uniform u in [0, 1].
     * A server Retry-After replaces the schedule: capped at 900000 ms, not
     * jittered. There is no attempt limit.
     */
    fun backoffMs(attempts: Int, retryAfterMs: Long?, jitterUnit: Double): Long {
        if (retryAfterMs != null) return retryAfterMs.coerceIn(0L, MAX_DELAY_MS)
        val exponent = attempts.coerceIn(0, MAX_EXPONENT)
        val base = minOf((1L shl exponent) * BASE_DELAY_MS, MAX_DELAY_MS)
        val u = if (jitterUnit.isNaN()) 0.5 else jitterUnit.coerceIn(0.0, 1.0)
        return (base * (1.0 + JITTER * (2.0 * u - 1.0))).roundToLong()
    }

    /** Classifies a non-success HTTP answer from its status and API error code. */
    fun classify(status: Int, code: String?): HttpClass = when {
        status == 401 -> HttpClass.UNAUTHORIZED
        status == 410 && code == "CURSOR_EXPIRED" -> HttpClass.CURSOR_EXPIRED
        status == 404 || status == 410 -> HttpClass.NOT_FOUND
        status == 409 && (code == "IDEMPOTENCY_KEY_REUSED" || code == "IDEMPOTENCY_MISMATCH") ->
            HttpClass.DEFINITIVE
        status == 409 && code == "IN_PROGRESS" -> HttpClass.TRANSIENT
        status == 409 || status == 412 -> HttpClass.CONFLICT
        status == 408 || status == 425 || status == 429 -> HttpClass.TRANSIENT
        status in 500..599 -> HttpClass.TRANSIENT
        status in 400..499 -> HttpClass.DEFINITIVE
        else -> HttpClass.PROTOCOL
    }

    /**
     * Next state of a row whose attempt produced [result].
     *
     * @param op the row's operation ([com.kubuno.android.sync.Ops]); a trash of
     *   an item already gone server-side is the goal state.
     * @param attempts failed attempts so far (before this one).
     * @param jitterUnit uniform random number in [0, 1].
     */
    fun decide(op: String, attempts: Int, result: SendResult, now: Long, jitterUnit: Double): Decision {
        val failed = attempts.coerceAtLeast(0) + 1

        fun retry(error: String, cls: HttpClass, retryAfterMs: Long? = null, stop: Boolean = false) =
            Decision.Retry(
                attempts = failed,
                nextAttemptAt = now + backoffMs(attempts, retryAfterMs, jitterUnit),
                error = error,
                errorClass = cls,
                stopPass = stop,
            )

        return when (result) {
            SendResult.Success -> Decision.Remove
            is SendResult.Network ->
                retry("network: ${result.message ?: "no answer"}", HttpClass.TRANSIENT, stop = true)
            is SendResult.Unparseable ->
                retry("unparseable answer: ${result.message ?: "?"}", HttpClass.PROTOCOL)
            is SendResult.Invalid -> Decision.Reject(failed, result.reason, HttpClass.DEFINITIVE)
            is SendResult.Http -> {
                val cls = classify(result.status, result.code)
                val error = "HTTP ${result.status}" + (result.code?.let { " $it" } ?: "")
                when (cls) {
                    HttpClass.TRANSIENT ->
                        retry(error, cls, result.retryAfterMs, stop = result.status == 429)
                    HttpClass.PROTOCOL -> retry(error, cls, result.retryAfterMs)
                    // The client already refreshed once (OkHttp authenticator):
                    // every following request would be refused too. Keep the row
                    // and wait; a dead session is handled by the account layer.
                    HttpClass.UNAUTHORIZED -> retry(error, cls, stop = true)
                    // Not a feed request: an outbox replay never expects it.
                    HttpClass.CURSOR_EXPIRED -> retry(error, HttpClass.PROTOCOL)
                    HttpClass.NOT_FOUND ->
                        if (op == TRASH_OP) Decision.Remove else Decision.Reject(failed, error, cls)
                    // Drive mutations carry no If-Match and the drive has no
                    // arbitration for them: a conflict needs the user.
                    HttpClass.CONFLICT -> Decision.Reject(failed, error, cls)
                    HttpClass.DEFINITIVE -> Decision.Reject(failed, error, cls)
                }
            }
        }
    }

    /**
     * Parses a `Retry-After` header (delta-seconds or HTTP-date) into
     * milliseconds from [nowMs]; null when absent or unreadable.
     */
    fun parseRetryAfterMs(value: String?, nowMs: Long): Long? {
        val v = value?.trim().orEmpty()
        if (v.isEmpty()) return null
        v.toLongOrNull()?.let { return if (it < 0) null else it * 1000 }
        return runCatching {
            val at = ZonedDateTime.parse(v, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli()
            (at - nowMs).coerceAtLeast(0)
        }.getOrNull()
    }

    private val lenient = Json { ignoreUnknownKeys = true; isLenient = true }

    /**
     * Extracts the API error code from an error body: `{"error":"CODE"}` (the
     * core envelope), `{"error":{"code":"CODE"}}` or `{"code":"CODE"}`.
     */
    fun parseErrorCode(body: String?): String? {
        if (body.isNullOrBlank()) return null
        val obj = runCatching { lenient.parseToJsonElement(body) as? JsonObject }.getOrNull() ?: return null
        (obj["error"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull?.let { return it }
        ((obj["error"] as? JsonObject)?.get("code") as? JsonPrimitive)?.contentOrNull?.let { return it }
        return (obj["code"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    }

    /** Mirrors [com.kubuno.android.sync.Ops.TRASH] without a dependency on it. */
    private const val TRASH_OP = "trash"
}
