package com.kubuno.android.sync.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** Single-row key/value store; currently only key = "cursor" (delta cursor). */
@Entity(tableName = "meta")
data class MetaEntity(
    @PrimaryKey val key: String,
    val value: String,
)

@Entity(tableName = "folders", indices = [Index("parentId")])
data class FolderEntity(
    @PrimaryKey val id: String,
    val parentId: String?,
    val name: String,
    val path: String,
    val starred: Boolean,
    val trashed: Boolean,
    val color: String?,
    val updatedAt: String?,
    val changeSeq: Long,
)

/**
 * Local mutations waiting to reach the server, replayed in `seq` order.
 *
 * Each row carries the Idempotency-Key the request will use, so a replay after
 * a crash or a lost response is a no-op server-side rather than a duplicate.
 * Every row gets a UUID minted when it is queued.
 *
 * A row is never given up: a transient failure keeps it [state] = "pending"
 * with a backoff persisted in [nextAttemptAt] (so the schedule survives process
 * death), and a definitive refusal moves it to "failed", where it stays,
 * visible to the user, until they retry or discard it. See
 * [com.kubuno.android.sync.outbox.OutboxPolicy].
 */
@Entity(tableName = "outbox")
data class OutboxEntity(
    @PrimaryKey(autoGenerate = true) val seq: Long = 0,
    val idempotencyKey: String,
    /** rename | move | trash | restore | star | mkdir */
    val op: String,
    val targetId: String?,
    val isFolder: Boolean,
    /**
     * JSON payload; shape depends on [op]. Besides the request fields it may
     * hold the value before the edit (`prev_name`, `prev_parent`), used only to
     * roll the local change back when the user discards the row.
     */
    val payload: String,
    /** Failed attempts so far; reset by a manual retry. */
    val attempts: Int = 0,
    val lastError: String? = null,
    val createdAt: Long,
    /** pending | failed ([com.kubuno.android.sync.outbox.OutboxStates]). */
    @ColumnInfo(defaultValue = "pending") val state: String = "pending",
    /** Epoch ms before which the drain leaves the row alone; 0 = due now. */
    @ColumnInfo(defaultValue = "0") val nextAttemptAt: Long = 0,
    /** Class of the last failure ([com.kubuno.android.sync.outbox.HttpClass.wire]). */
    val lastErrorClass: String? = null,
)

/**
 * Camera-roll items already pushed, keyed by their MediaStore id.
 *
 * The content hash is kept as well: the same picture can reappear under a new
 * MediaStore id (restore, re-import, gallery app rewriting the file), and the
 * hash is what actually decides whether the server already holds it.
 */
@Entity(tableName = "auto_upload_ledger", indices = [Index("contentHash")])
data class AutoUploadEntity(
    @PrimaryKey val mediaStoreId: Long,
    val contentHash: String,
    val uploadedFileId: String?,
    val uploadedAt: Long,
)

/** Files the user asked to keep available offline. */
@Entity(tableName = "pins")
data class PinEntity(
    @PrimaryKey val fileId: String,
    val pinnedAt: Long,
)

/**
 * A pinned file's local copy. [etag] records which revision sits on disk, so a
 * delta that changes it triggers a fresh download.
 */
@Entity(tableName = "local_copies")
data class LocalCopyEntity(
    @PrimaryKey val fileId: String,
    val path: String,
    val etag: String,
    val size: Long,
    val downloadedAt: Long,
)

/** Upload and download jobs, surfaced in the transfers screen. */
@Entity(tableName = "transfers")
data class TransferEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    /** upload | download */
    val kind: String,
    /** Content URI for an upload, file id for a download. */
    val source: String,
    val name: String,
    val mimeType: String?,
    val folderId: String?,
    val fileId: String?,
    val totalSize: Long,
    val bytesDone: Long = 0,
    /** Chunked-session bookkeeping; null for a single-shot upload. */
    val sessionId: String? = null,
    val chunkSize: Long = 0,
    val nextChunk: Int = 0,
    val idempotencyKey: String,
    /** queued | running | done | failed */
    val state: String = "queued",
    val error: String? = null,
    val createdAt: Long,
)

@Entity(tableName = "files", indices = [Index("folderId")])
data class FileEntity(
    @PrimaryKey val id: String,
    val folderId: String?,
    val name: String,
    val mimeType: String?,
    val size: Long,
    /** Content hash (SHA-256) — the drive's etag. */
    val etag: String?,
    val starred: Boolean,
    val trashed: Boolean,
    val hasThumbnail: Boolean,
    val updatedAt: String?,
    val changeSeq: Long,
)
