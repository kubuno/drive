package com.kubuno.android.sync.work

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.hilt.work.HiltWorker
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.kubuno.android.api.KubunoClient
import com.kubuno.android.api.model.CreateFolderRequest
import com.kubuno.android.data.AppPrefs
import com.kubuno.android.sync.SyncEngine
import com.kubuno.android.sync.db.AutoUploadEntity
import com.kubuno.android.sync.db.KubunoDatabase
import com.kubuno.android.sync.transfer.SIMPLE_UPLOAD_MAX
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Pushes new camera-roll items to the drive.
 *
 * Detection uses a content-URI trigger that re-enqueues itself: a
 * ContentObserver would not survive process death, and MediaStore only tells
 * us "something changed", never what. Each run therefore re-queries by
 * DATE_ADDED and leans on the ledger to know what is already up.
 *
 * Deduplication runs twice over: the MediaStore id catches the common case,
 * the SHA-256 catches the same picture reappearing under a new id. The hash also
 * becomes the Idempotency-Key, so even a lost ledger cannot create a duplicate
 * server-side within the key's 24h window.
 */
@HiltWorker
class AutoUploadWorker @AssistedInject constructor(
    @Assisted private val context: Context,
    @Assisted params: WorkerParameters,
    private val db: KubunoDatabase,
    private val client: KubunoClient,
    private val prefs: AppPrefs,
    private val engine: SyncEngine,
) : CoroutineWorker(context, params) {

    companion object {
        private const val TRIGGER_WORK = "auto-upload-trigger"
        private const val PERIODIC_WORK = "auto-upload-periodic"

        /**
         * Re-arms the content-URI trigger and the safety-net periodic run.
         *
         * [fromWorker] matters: a content trigger fires once, so the worker has
         * to book the next one — but it runs *under* [TRIGGER_WORK] itself, and
         * REPLACE would read as "cancel the work that is running", killing the
         * very run doing the asking (and with it the whole chain). Appending
         * instead queues the next trigger behind the current run.
         */
        fun schedule(workManager: WorkManager, prefs: AppPrefs, fromWorker: Boolean = false) {
            if (!prefs.autoUploadEnabled) {
                workManager.cancelUniqueWork(TRIGGER_WORK)
                workManager.cancelUniqueWork(PERIODIC_WORK)
                return
            }
            workManager.enqueueUniqueWork(
                TRIGGER_WORK,
                if (fromWorker) ExistingWorkPolicy.APPEND_OR_REPLACE else ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<AutoUploadWorker>()
                    .setConstraints(constraints(prefs, withTriggers = true))
                    .build(),
            )
            workManager.enqueueUniquePeriodicWork(
                PERIODIC_WORK,
                ExistingPeriodicWorkPolicy.UPDATE,
                PeriodicWorkRequestBuilder<AutoUploadWorker>(6, TimeUnit.HOURS)
                    .setConstraints(constraints(prefs, withTriggers = false))
                    .build(),
            )
        }

        private fun constraints(prefs: AppPrefs, withTriggers: Boolean): Constraints =
            Constraints.Builder()
                .setRequiredNetworkType(
                    if (prefs.autoUploadWifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED
                )
                .setRequiresCharging(prefs.autoUploadWhileCharging)
                .apply {
                    if (withTriggers) {
                        addContentUriTrigger(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true)
                        if (prefs.autoUploadVideos) {
                            addContentUriTrigger(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true)
                        }
                        setTriggerContentUpdateDelay(10, TimeUnit.SECONDS)
                    }
                }
                .build()
    }

    override suspend fun doWork(): Result {
        if (!prefs.autoUploadEnabled) return Result.success()
        if (!client.tokenManager.isLoggedIn()) return Result.success()

        val folderId = try {
            resolveTargetFolder()
        } catch (e: IOException) {
            reschedule()
            return Result.retry()
        }

        var uploaded = 0
        try {
            for (item in newMedia()) {
                if (db.autoUploadDao().hasMediaId(item.id) != null) continue
                val hash = hashOf(item.uri) ?: continue
                if (db.autoUploadDao().hasHash(hash) != null) {
                    // Same bytes under a new MediaStore id: record and move on.
                    db.autoUploadDao().record(
                        AutoUploadEntity(item.id, hash, null, System.currentTimeMillis())
                    )
                    continue
                }
                val fileId = upload(item, folderId, hash)
                db.autoUploadDao().record(
                    AutoUploadEntity(item.id, hash, fileId, System.currentTimeMillis())
                )
                uploaded++
            }
        } catch (e: IOException) {
            reschedule()
            return if (runAttemptCount >= 3) Result.success() else Result.retry()
        }

        if (uploaded > 0) runCatching { engine.pull() }
        reschedule()
        return Result.success()
    }

    /** The trigger fires once, so the next one has to be booked by hand. */
    private fun reschedule() =
        schedule(WorkManager.getInstance(context), prefs, fromWorker = true)

    private data class MediaItem(
        val id: Long,
        val uri: Uri,
        val name: String,
        val size: Long,
        val mimeType: String?,
        val isVideo: Boolean,
    )

    private fun newMedia(): List<MediaItem> {
        val since = prefs.autoUploadSince
        val items = mutableListOf<MediaItem>()
        val collections = buildList {
            add(MediaStore.Images.Media.EXTERNAL_CONTENT_URI to false)
            if (prefs.autoUploadVideos) add(MediaStore.Video.Media.EXTERNAL_CONTENT_URI to true)
        }
        val projection = arrayOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.DATE_ADDED,
        )
        for ((collection, isVideo) in collections) {
            context.contentResolver.query(
                collection,
                projection,
                "${MediaStore.MediaColumns.DATE_ADDED} > ?",
                arrayOf(since.toString()),
                "${MediaStore.MediaColumns.DATE_ADDED} ASC",
            )?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
                val nameCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
                val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
                val mimeCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE)
                while (cursor.moveToNext()) {
                    val id = cursor.getLong(idCol)
                    items += MediaItem(
                        id = id,
                        uri = ContentUris.withAppendedId(collection, id),
                        name = cursor.getString(nameCol) ?: "media-$id",
                        size = cursor.getLong(sizeCol),
                        mimeType = cursor.getString(mimeCol),
                        isVideo = isVideo,
                    )
                }
            }
        }
        return items
    }

    private fun hashOf(uri: Uri): String? = runCatching {
        context.contentResolver.openInputStream(uri)?.use { stream ->
            val digest = MessageDigest.getInstance("SHA-256")
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = stream.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
            digest.digest().joinToString("") { "%02x".format(it) }
        }
    }.getOrNull()

    /**
     * Uploads through the drive rather than the photos module: photos has no
     * chunked endpoint, no delta and no lookup by hash, so a large video could
     * neither resume nor be deduplicated there.
     */
    private suspend fun upload(item: MediaItem, folderId: String?, hash: String): String? {
        val key = "autoupload:$hash"
        val mime = item.mimeType ?: "application/octet-stream"

        if (item.size in 1..SIMPLE_UPLOAD_MAX) {
            val bytes = context.contentResolver.openInputStream(item.uri)
                ?.use(InputStream::readBytes) ?: throw IOException("cannot read ${item.name}")
            val part = MultipartBody.Part.createFormData(
                "file", item.name, bytes.toRequestBody(mime.toMediaTypeOrNull()),
            )
            val folderPart = folderId?.toRequestBody("text/plain".toMediaTypeOrNull())
            val response = client.driveApi.upload(part, folderPart, key)
            if (!response.isSuccessful) {
                if (response.code() == 429 || response.code() >= 500) {
                    throw IOException("upload failed with ${response.code()}")
                }
                return null // definitive rejection: record it so we stop retrying
            }
            return response.body()?.file?.id
        }

        // Large item: hand it to the resumable queue, which owns the chunking
        // rules (an index is sent at most once per session).
        db.transferDao().enqueue(
            com.kubuno.android.sync.db.TransferEntity(
                kind = "upload",
                source = item.uri.toString(),
                name = item.name,
                mimeType = item.mimeType,
                folderId = folderId,
                fileId = null,
                totalSize = item.size,
                idempotencyKey = key,
                createdAt = System.currentTimeMillis(),
            )
        )
        TransferWorker.enqueue(WorkManager.getInstance(context))
        return null
    }

    /** Creates "Photos from <device>" once, then reuses its id. */
    private suspend fun resolveTargetFolder(): String? {
        prefs.autoUploadFolderId?.let { return it }
        val name = "Photos from ${deviceName()}"
        val id = UUID.randomUUID().toString()
        val response = client.driveApi.createFolder(
            CreateFolderRequest(name = name, parentId = null, id = id),
            "autoupload-folder:$id",
        )
        if (!response.isSuccessful) {
            if (response.code() == 429 || response.code() >= 500) {
                throw IOException("cannot create the destination folder")
            }
            return null // fall back to the drive root
        }
        val created = response.body()?.folder?.id ?: id
        prefs.autoUploadFolderId = created
        return created
    }

    private fun deviceName(): String {
        val model = Build.MODEL.orEmpty()
        val manufacturer = Build.MANUFACTURER.orEmpty()
        return when {
            model.startsWith(manufacturer, ignoreCase = true) -> model
            else -> "$manufacturer $model"
        }.trim().ifEmpty { "Android" }
    }
}
