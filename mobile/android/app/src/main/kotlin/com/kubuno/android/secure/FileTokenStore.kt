package com.kubuno.android.secure

import android.content.Context
import com.kubuno.android.api.auth.StoredTokens
import com.kubuno.android.api.auth.TokenStore
import java.io.File
import java.io.FileOutputStream
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
private data class PersistedSession(
    @SerialName("access") val accessToken: String,
    @SerialName("refresh") val refreshToken: String,
    @SerialName("rotated_at") val lastRefreshAtMs: Long,
)

/**
 * Token persistence: Keystore-encrypted JSON in an app-private file.
 *
 * Durability is part of the auth contract (see [TokenStore]): the write goes
 * to a temp file, is fsynced, then atomically renamed — losing a rotated
 * refresh token to a crash would burn the session (reuse_detected).
 */
class FileTokenStore(context: Context) : TokenStore {
    private val json = Json { ignoreUnknownKeys = true }
    private val file = File(context.filesDir, "session.bin")
    private val tmp = File(context.filesDir, "session.bin.tmp")
    private val lock = Any()

    override fun load(): StoredTokens? = synchronized(lock) {
        if (!file.exists()) return null
        val plain = CryptoBox.decrypt(file.readBytes()) ?: run {
            file.delete() // unreadable blob is useless — force re-login
            return null
        }
        runCatching {
            val s = json.decodeFromString<PersistedSession>(plain.decodeToString())
            StoredTokens(s.accessToken, s.refreshToken, s.lastRefreshAtMs)
        }.getOrNull()
    }

    override fun save(tokens: StoredTokens) = synchronized(lock) {
        val payload = json.encodeToString(
            PersistedSession(tokens.accessToken, tokens.refreshToken, tokens.lastRefreshAtMs)
        )
        val blob = CryptoBox.encrypt(payload.toByteArray())
        FileOutputStream(tmp).use { out ->
            out.write(blob)
            out.fd.sync()
        }
        if (!tmp.renameTo(file)) {
            // Rename over an existing file can fail on some filesystems: delete then retry.
            file.delete()
            check(tmp.renameTo(file)) { "Could not persist session" }
        }
    }

    override fun clear(): Unit = synchronized(lock) {
        file.delete()
        tmp.delete()
    }
}
