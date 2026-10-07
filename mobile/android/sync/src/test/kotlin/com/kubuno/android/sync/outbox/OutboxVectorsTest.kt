package com.kubuno.android.sync.outbox

import com.kubuno.vectors.ConformanceVectors
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import org.junit.Test

/**
 * The outbox policy against the shared conformance vectors (vendored from
 * kubuno/core at the tag recorded in vectors/sync/VENDOR.json).
 */
class OutboxVectorsTest {

    private fun suite(name: String) =
        ConformanceVectors.resource("vectors/sync/$name", OutboxVectorsTest::class.java)

    @Test
    fun `backoff follows sync_outbox_backoff`() {
        ConformanceVectors.assertSuite(suite("outbox-backoff.json")) { input: JsonElement ->
            val o = input.jsonObject
            val retryAfter = o["retry_after_ms"]?.takeUnless { it is JsonNull }?.jsonPrimitive?.long
            val delay = OutboxPolicy.backoffMs(
                attempts = o.getValue("attempts").jsonPrimitive.int,
                retryAfterMs = retryAfter,
                jitterUnit = o.getValue("jitter_unit").jsonPrimitive.double,
            )
            buildJsonObject { put("delay_ms", delay) }
        }
    }

    @Test
    fun `classification follows sync_http_classify`() {
        ConformanceVectors.assertSuite(suite("http-classify.json")) { input: JsonElement ->
            val o = input.jsonObject
            val code = o["code"]?.takeUnless { it is JsonNull }?.jsonPrimitive?.content
            JsonPrimitive(OutboxPolicy.classify(o.getValue("status").jsonPrimitive.int, code).wire)
        }
    }
}
