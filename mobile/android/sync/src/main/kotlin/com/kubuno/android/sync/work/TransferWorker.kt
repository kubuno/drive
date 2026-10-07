package com.kubuno.android.sync.work

import android.content.Context
import android.net.Uri
import androidx.hilt.work.HiltWorker
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.Data
import com.kubuno.android.account.AccountGraphFactory
import com.kubuno.android.account.AccountId
import com.kubuno.android.api.KubunoClient
import com.kubuno.android.api.model.InitUploadRequest
import com.kubuno.android.sync.SyncEngine
import com.kubuno.android.sync.db.KubunoDatabase
import com.kubuno.android.sync.db.TransferEntity
import com.kubuno.android.sync.transfer.CHUNK_SIZE
import com.kubuno.android.sync.transfer.SIMPLE_UPLOAD_MAX
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.io.File
import java.io.IOException
import java.io.InputStream
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Runs the transfer queue: uploads (single-shot or resumable) and downloads.
 *
 * Chunked uploads deserve a warning: the server counts accepted chunks but
 * keeps no per-index record and increments that counter even for a duplicate.
 * Re-sending an already-acknowledged chunk therefore lets `chunks_received`
 * reach the total while a real chunk is still missing, and the assembly fails
 * with a 500. So a chunk index is only ever sent once per session, and a
 * session we are unsure about is abandoned rather than resumed.
 */
@HiltWorker
class TransferWorker @AssistedInject constructor(
    @Assisted private val context: Context,
    @Assisted params: WorkerParameters,
    private val graphs: AccountGraphFactory,
) : CoroutineWorker(context, params) {

    private lateinit var db: KubunoDatabase
    private lateinit var client: KubunoClient
    private lateinit var engine: SyncEngine
    private var accountId: AccountId = AccountId("")

    companion object {

        fun enqueue(workManager: WorkManager, accountId: AccountId) {
            val request = OneTimeWorkRequestBuilder<TransferWorker>()
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
                )
                .setInputData(Data.Builder().putString(KEY_ACCOUNT_ID, accountId.value).build())
                .addTag(accountTag(accountId))
                .build()
            workManager.enqueueUniqueWork(
                workName(accountId), ExistingWorkPolicy.APPEND_OR_REPLACE, request,
            )
        }

        /** One queue per account, so a stalled transfer blocks only its own. */
        fun workName(id: AccountId) = "drive-transfers:" + id.value
    }

    override suspend fun doWork(): Result {
        accountId = inputData.getString(KEY_ACCOUNT_ID)?.let(::AccountId) ?: return Result.failure()
        val graph = graphs.graphOf(accountId) ?: return Result.failure()
        db = graph.db
        client = graph.client
        engine = graph.engine

        val pending = db.transferDao().active()
        if (pending.isEmpty()) return Result.success()

        var sawTransient = false
        var uploaded = false
        for (transfer in pending) {
            try {
                when (transfer.kind) {
                    "upload" -> { runUpload(transfer); uploaded = true }
                    "download" -> runDownload(transfer)
                }
            } catch (e: IOException) {
                db.transferDao().finish(transfer.id, "queued", e.message)
                sawTransient = true
            } catch (e: Exception) {
                db.transferDao().finish(transfer.id, "failed", e.message)
            }
        }

        // Pull straight away so a freshly uploaded file appears without waiting
        // for the next sync trigger.
        if (uploaded) runCatching { engine.pull() }

        return if (sawTransient && runAttemptCount < 5) Result.retry() else Result.success()
    }

    private suspend fun runUpload(transfer: TransferEntity) {
        db.transferDao().progress(transfer.id, transfer.bytesDone, transfer.nextChunk)
        val uri = Uri.parse(transfer.source)
        val mime = transfer.mimeType ?: "application/octet-stream"

        if (transfer.totalSize in 1..SIMPLE_UPLOAD_MAX) {
            val bytes = context.contentResolver.openInputStream(uri)?.use(InputStream::readBytes)
                ?: throw IOException("cannot read ${transfer.name}")
            val part = MultipartBody.Part.createFormData(
                "file", transfer.name, bytes.toRequestBody(mime.toMediaTypeOrNull()),
            )
            val folderPart = transfer.folderId?.toRequestBody("text/plain".toMediaTypeOrNull())
            val response = client.driveApi.upload(part, folderPart, transfer.idempotencyKey)
            if (!response.isSuccessful) fail(response.code(), transfer)
            db.transferDao().progress(transfer.id, transfer.totalSize, 0)
            db.transferDao().finish(transfer.id, "done", null)
            return
        }

        // Resumable path.
        var session = transfer.sessionId
        var nextChunk = transfer.nextChunk
        if (session == null) {
            val init = client.driveApi.initUpload(
                InitUploadRequest(
                    filename = transfer.name,
                    totalSize = transfer.totalSize,
                    chunkSize = CHUNK_SIZE,
                    folderId = transfer.folderId,
                    mimeType = transfer.mimeType,
                ),
                transfer.idempotencyKey,
            )
            if (!init.isSuccessful) fail(init.code(), transfer)
            session = init.body()!!.upload.id
            nextChunk = 0
            db.transferDao().attachSession(transfer.id, session, CHUNK_SIZE)
        }

        val totalChunks = ((transfer.totalSize + CHUNK_SIZE - 1) / CHUNK_SIZE).toInt()
        context.contentResolver.openInputStream(uri)?.use { stream ->
            // Skip what a previous run already acknowledged.
            var skipped = 0L
            val toSkip = nextChunk.toLong() * CHUNK_SIZE
            while (skipped < toSkip) {
                val jumped = stream.skip(toSkip - skipped)
                if (jumped <= 0) throw IOException("cannot resume ${transfer.name}")
                skipped += jumped
            }

            val buffer = ByteArray(CHUNK_SIZE.toInt())
            var index = nextChunk
            while (index < totalChunks) {
                val read = stream.readNBytes(buffer, 0, buffer.size)
                if (read <= 0) break
                val part = MultipartBody.Part.createFormData(
                    "chunk", "chunk-$index",
                    buffer.copyOf(read).toRequestBody("application/octet-stream".toMediaTypeOrNull()),
                )
                val response = client.driveApi.uploadChunk(session, index, part)
                if (!response.isSuccessful) {
                    // The session's chunk bookkeeping is now uncertain: drop it
                    // rather than risk a corrupt assembly on a later retry.
                    runCatching { client.driveApi.abortUpload(session) }
                    db.transferDao().update(
                        db.transferDao().byId(transfer.id)!!.copy(sessionId = null, nextChunk = 0, bytesDone = 0)
                    )
                    fail(response.code(), transfer)
                }
                index++
                db.transferDao().progress(transfer.id, index.toLong() * CHUNK_SIZE, index)
            }
        } ?: throw IOException("cannot read ${transfer.name}")

        val complete = client.driveApi.completeUpload(session, "${transfer.idempotencyKey}-complete")
        if (!complete.isSuccessful) fail(complete.code(), transfer)
        db.transferDao().progress(transfer.id, transfer.totalSize, totalChunks)
        db.transferDao().finish(transfer.id, "done", null)
    }

    /**
     * Downloads stream to app-private storage. The server sends no Range
     * support, so an interrupted download restarts from zero.
     */
    private suspend fun runDownload(transfer: TransferEntity) {
        db.transferDao().progress(transfer.id, 0, 0)
        val fileId = transfer.fileId ?: throw IOException("download without a file id")
        val response = client.driveApi.download(fileId)
        if (!response.isSuccessful) fail(response.code(), transfer)

        val dir = File(context.filesDir, "downloads/" + accountId.value + "/" + fileId).apply { mkdirs() }
        val target = File(dir, transfer.name)
        val temp = File(dir, "${transfer.name}.part")

        response.body()!!.byteStream().use { input ->
            temp.outputStream().use { output ->
                val buffer = ByteArray(64 * 1024)
                var done = 0L
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    output.write(buffer, 0, read)
                    done += read
                    db.transferDao().progress(transfer.id, done, 0)
                }
                output.fd.sync()
            }
        }
        if (target.exists()) target.delete()
        if (!temp.renameTo(target)) throw IOException("cannot store ${transfer.name}")
        db.transferDao().finish(transfer.id, "done", null)
    }

    private fun fail(code: Int, transfer: TransferEntity): Nothing {
        // 429/5xx are worth another attempt; anything else is the server saying no.
        if (code == 429 || code >= 500) throw IOException("transfer ${transfer.id} failed with $code")
        throw IllegalStateException("HTTP $code")
    }
}

/** Fills the buffer across short reads; content URIs rarely deliver in one go. */
private fun InputStream.readNBytes(buffer: ByteArray, offset: Int, length: Int): Int {
    var total = 0
    while (total < length) {
        val read = read(buffer, offset + total, length - total)
        if (read < 0) break
        total += read
    }
    return total
}
