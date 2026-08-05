package com.kubuno.android.sync.db

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
 * Folder creation uses a key derived from its path (stable across retries);
 * everything else gets a UUID minted when the row is queued.
 */
@Entity(tableName = "outbox")
data class OutboxEntity(
    @PrimaryKey(autoGenerate = true) val seq: Long = 0,
    val idempotencyKey: String,
    /** rename | move | trash | restore | star | unstar | mkdir */
    val op: String,
    val targetId: String?,
    val isFolder: Boolean,
    /** JSON payload; shape depends on [op]. */
    val payload: String,
    val attempts: Int = 0,
    val lastError: String? = null,
    val createdAt: Long,
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
