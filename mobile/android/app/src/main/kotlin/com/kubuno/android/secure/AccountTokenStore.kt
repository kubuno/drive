package com.kubuno.android.secure

import android.content.Context
import com.kubuno.android.account.AccountId
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
 * One encrypted session file per account, under `filesDir/sessions/<id>.bin`.
 *
 * A single blob holding every account would be a bad trade: this store wipes
 * what it cannot decrypt (a corrupt file or a rotated Keystore key is
 * unrecoverable), and doing that to a shared blob would sign every account out
 * at once. Separate files keep that blast radius to one account.
 *
 * Durability is part of the auth contract: the write goes to a temp file, is
 * fsynced, then atomically renamed. Losing a rotated refresh token to a crash
 * would burn the session family server-side.
 */
class AccountTokenStore(
    context: Context,
    accountId: AccountId,
) : TokenStore {
    private val json = Json { ignoreUnknownKeys = true }
    private val dir = File(context.filesDir, "sessions").apply { mkdirs() }
    private val file = File(dir, "${accountId.value}.bin")
    private val tmp = File(dir, "${accountId.value}.bin.tmp")
    private val lock = Any()

    override fun load(): StoredTokens? = synchronized(lock) {
        if (!file.exists()) return null
        val plain = CryptoBox.decrypt(file.readBytes()) ?: run {
            file.delete()
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
            file.delete()
            check(tmp.renameTo(file)) { "Could not persist session" }
        }
    }

    override fun clear(): Unit = synchronized(lock) {
        file.delete()
        tmp.delete()
    }
}
