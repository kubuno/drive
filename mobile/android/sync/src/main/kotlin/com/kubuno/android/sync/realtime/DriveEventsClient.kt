package com.kubuno.android.sync.realtime

import android.util.Log
import com.kubuno.android.api.KubunoClient
import com.kubuno.android.api.auth.AuthException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/**
 * Foreground-only realtime listener on the core's `GET /ws?token=<access>`.
 *
 * The server never pings, so the client does (30 s). The socket is a pure
 * wake-up signal: on any drive-related event we debounce and trigger a sync.
 * Reconnection uses a flat 5 s backoff and always fetches a fresh access
 * token (the previous one may have rotated). Doze handling is out of scope:
 * background freshness is UnifiedPush's job (M5).
 */
class DriveEventsClient(
    private val client: KubunoClient,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val wsClient: OkHttpClient = client.okHttpClient.newBuilder()
        .pingInterval(30, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    @Volatile private var wanted = false
    @Volatile private var socket: WebSocket? = null
    private var debounceJob: Job? = null
    private var onDriveChanged: (() -> Unit)? = null

    companion object {
        private const val TAG = "KubunoWs"
        private const val RECONNECT_DELAY_MS = 5_000L
        private const val DEBOUNCE_MS = 1_500L
        private val DRIVE_MARKERS = listOf(
            "drive.changed", "\"module_id\":\"drive\"",
            "FileUploaded", "FileDeleted", "FileMoved",
        )
    }

    fun start(onDriveChanged: () -> Unit) {
        this.onDriveChanged = onDriveChanged
        if (wanted) return
        wanted = true
        scope.launch { connect() }
    }

    fun stop() {
        wanted = false
        debounceJob?.cancel()
        socket?.close(1000, null)
        socket = null
        scope.coroutineContext.cancelChildren()
    }

    private suspend fun connect() {
        if (!wanted) return
        val base = client.serverBaseUrl() ?: run {
            Log.d(TAG, "no server configured, not connecting"); return
        }
        val token = try {
            client.tokenManager.validAccessToken() ?: run {
                Log.d(TAG, "no session, not connecting"); return
            }
        } catch (e: AuthException) {
            Log.d(TAG, "token unavailable (${e.kind}), retrying")
            scheduleReconnect(); return
        }
        val url = base.replaceFirst("http", "ws") + "/ws?token=$token"
        Log.d(TAG, "connecting to ${base.replaceFirst("http", "ws")}/ws")
        val request = Request.Builder().url(url).build()
        socket = wsClient.newWebSocket(request, listener)
    }

    private fun scheduleReconnect() {
        if (!wanted) return
        scope.launch {
            delay(RECONNECT_DELAY_MS)
            connect()
        }
    }

    private val listener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            Log.d(TAG, "connected")
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            Log.d(TAG, "event: ${text.take(160)}")
            if (DRIVE_MARKERS.any { text.contains(it) }) {
                debounceJob?.cancel()
                debounceJob = scope.launch {
                    delay(DEBOUNCE_MS)
                    onDriveChanged?.invoke()
                }
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            Log.d(TAG, "failure: ${t.javaClass.simpleName}: ${t.message} (http ${response?.code})")
            socket = null
            scheduleReconnect()
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            socket = null
            scheduleReconnect()
        }
    }
}
