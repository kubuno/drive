package com.kubuno.android.sync.transfer

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.work.WorkManager
import com.kubuno.android.sync.db.KubunoDatabase
import com.kubuno.android.sync.db.TransferEntity
import com.kubuno.android.sync.work.TransferWorker
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow

/** Chunks stay just under the server's 10 MiB route limit, which counts the
 *  whole multipart body (boundary and headers included). */
const val CHUNK_SIZE: Long = 8L * 1024 * 1024

/** Below this we use the single-shot upload; above it, a resumable session. */
const val SIMPLE_UPLOAD_MAX: Long = 8L * 1024 * 1024

@Singleton
class TransferQueue @Inject constructor(
    @ApplicationContext private val context: Context,
    private val db: KubunoDatabase,
    private val workManager: WorkManager,
) {
    fun all(): Flow<List<TransferEntity>> = db.transferDao().all()

    suspend fun enqueueUpload(uri: Uri, folderId: String?) {
        val (name, size) = probe(uri)
        db.transferDao().enqueue(
            TransferEntity(
                kind = "upload",
                source = uri.toString(),
                name = name,
                mimeType = context.contentResolver.getType(uri),
                folderId = folderId,
                fileId = null,
                totalSize = size,
                idempotencyKey = UUID.randomUUID().toString(),
                createdAt = System.currentTimeMillis(),
            )
        )
        TransferWorker.enqueue(workManager)
    }

    suspend fun enqueueDownload(fileId: String, name: String, size: Long, mimeType: String?) {
        db.transferDao().enqueue(
            TransferEntity(
                kind = "download",
                source = fileId,
                name = name,
                mimeType = mimeType,
                folderId = null,
                fileId = fileId,
                totalSize = size,
                idempotencyKey = UUID.randomUUID().toString(),
                createdAt = System.currentTimeMillis(),
            )
        )
        TransferWorker.enqueue(workManager)
    }

    suspend fun retry(id: Long) {
        val transfer = db.transferDao().byId(id) ?: return
        // A failed chunked session is restarted from scratch: the server has no
        // per-index bitmap, so resuming a half-known session risks a corrupt
        // assembly. Only a clean interruption resumes (see TransferWorker).
        db.transferDao().update(
            transfer.copy(
                state = "queued", error = null, bytesDone = 0,
                sessionId = null, nextChunk = 0,
                idempotencyKey = UUID.randomUUID().toString(),
            )
        )
        TransferWorker.enqueue(workManager)
    }

    suspend fun remove(id: Long) = db.transferDao().remove(id)

    suspend fun clearFinished() = db.transferDao().clearFinished()

    private fun probe(uri: Uri): Pair<String, Long> {
        var name = "file"
        var size = 0L
        context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (cursor.moveToFirst()) {
                if (nameIndex >= 0) name = cursor.getString(nameIndex) ?: name
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
            }
        }
        if (size == 0L && uri.scheme == ContentResolver.SCHEME_FILE) {
            size = uri.path?.let { java.io.File(it).length() } ?: 0L
        }
        return name to size
    }
}
