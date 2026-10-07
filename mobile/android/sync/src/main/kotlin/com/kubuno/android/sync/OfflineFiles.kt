package com.kubuno.android.sync

import android.content.Context
import com.kubuno.android.api.KubunoClient
import com.kubuno.android.sync.db.KubunoDatabase
import com.kubuno.android.sync.db.LocalCopyEntity
import com.kubuno.android.sync.db.PinEntity
import com.kubuno.android.account.AccountId
import java.io.File
import java.io.IOException
import kotlinx.coroutines.flow.Flow

/**
 * Files the user keeps available offline.
 *
 * A copy lives in app-private storage under its file id, and the etag it was
 * fetched at is recorded next to it. After each delta pull [refresh] compares
 * that etag with the one Room now holds and re-downloads what changed — the
 * pull is the only place that learns about a server-side edit.
 */
class OfflineFiles(
    private val context: Context,
    private val accountId: AccountId,
    private val db: KubunoDatabase,
    private val client: KubunoClient,
) {
    // Scoped by account: two accounts can hold the same server file id, and a
    // shared folder would let one erase the other’s copy.
    private val root: File get() = File(context.filesDir, "offline/" + accountId.value)

    fun isPinned(fileId: String): Flow<Int?> = db.pinDao().isPinned(fileId)

    fun offlineBytes(): Flow<Long> = db.pinDao().offlineBytes()

    suspend fun pin(fileId: String) {
        db.pinDao().pin(PinEntity(fileId, System.currentTimeMillis()))
        runCatching { fetch(fileId) }
    }

    suspend fun unpin(fileId: String) {
        db.pinDao().unpin(fileId)
        db.pinDao().removeCopy(fileId)
        File(root, fileId).deleteRecursively()
    }

    /** Local file for a pinned item, or null when it is not on disk (yet). */
    suspend fun localFile(fileId: String): File? {
        val copy = db.pinDao().copyOf(fileId) ?: return null
        return File(copy.path).takeIf { it.exists() }
    }

    /**
     * A local copy for viewing: the pinned copy if there is one, otherwise a
     * fresh download into the cache. Not recorded as a pin — this is a
     * throwaway for the file viewer, cleaned with the app's cache.
     */
    suspend fun cacheForViewing(fileId: String): File {
        localFile(fileId)?.let { return it }
        val file = db.fileDao().get(fileId) ?: throw IOException("unknown file $fileId")
        val response = client.driveApi.download(fileId)
        if (!response.isSuccessful) throw IOException("download failed (${response.code()})")
        val dir = File(context.cacheDir, "viewer/$fileId").apply { mkdirs() }
        val target = File(dir, file.name)
        response.body()!!.byteStream().use { input ->
            target.outputStream().use { output -> input.copyTo(output, 64 * 1024) }
        }
        return target
    }

    /** Drops every local copy but keeps the pins, so they refill on next sync. */
    suspend fun purge() {
        db.pinDao().clearCopies()
        root.deleteRecursively()
    }

    /**
     * Brings every pin in line with the store. Called after a delta pull, so a
     * file edited elsewhere is refreshed rather than silently stale.
     */
    suspend fun refresh() {
        for (fileId in db.pinDao().pinnedIds()) {
            val file = db.fileDao().get(fileId) ?: continue
            val copy = db.pinDao().copyOf(fileId)
            val onDisk = copy?.let { File(it.path).exists() } == true
            if (onDisk && copy?.etag == file.etag) continue
            runCatching { fetch(fileId) }
        }
    }

    private suspend fun fetch(fileId: String) {
        val file = db.fileDao().get(fileId) ?: return
        val response = client.driveApi.download(fileId)
        if (!response.isSuccessful) throw IOException("download failed (${response.code()})")

        val dir = File(root, fileId).apply { mkdirs() }
        val target = File(dir, file.name)
        val temp = File(dir, "${file.name}.part")

        response.body()!!.byteStream().use { input ->
            temp.outputStream().use { output ->
                input.copyTo(output, 64 * 1024)
                output.fd.sync()
            }
        }
        // Replace atomically: a half-written copy must never look complete.
        if (target.exists()) target.delete()
        if (!temp.renameTo(target)) throw IOException("cannot store ${file.name}")

        // Stale siblings appear when a pinned file is renamed server-side.
        dir.listFiles()?.forEach { if (it != target) it.delete() }

        db.pinDao().recordCopy(
            LocalCopyEntity(
                fileId = fileId,
                path = target.absolutePath,
                etag = file.etag.orEmpty(),
                size = target.length(),
                downloadedAt = System.currentTimeMillis(),
            )
        )
    }
}
