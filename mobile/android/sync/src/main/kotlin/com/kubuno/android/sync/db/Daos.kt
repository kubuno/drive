package com.kubuno.android.sync.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Update
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface MetaDao {
    @Query("SELECT value FROM meta WHERE `key` = :key")
    suspend fun get(key: String): String?

    @Upsert
    suspend fun set(entry: MetaEntity)
}

@Dao
interface FolderDao {
    @Query(
        """SELECT * FROM folders
           WHERE ((:parentId IS NULL AND parentId IS NULL) OR parentId = :parentId)
             AND trashed = 0
           ORDER BY name COLLATE NOCASE"""
    )
    fun children(parentId: String?): Flow<List<FolderEntity>>

    @Query("SELECT * FROM folders WHERE id = :id")
    fun byId(id: String): Flow<FolderEntity?>

    @Query("SELECT * FROM folders WHERE id = :id")
    suspend fun get(id: String): FolderEntity?

    @Upsert
    suspend fun upsert(folders: List<FolderEntity>)

    @Upsert
    suspend fun upsertOne(folder: FolderEntity)

    // Optimistic local edits; the delta pull reconciles them afterwards.
    @Query("UPDATE folders SET name = :name WHERE id = :id")
    suspend fun rename(id: String, name: String)

    @Query("UPDATE folders SET parentId = :parentId WHERE id = :id")
    suspend fun move(id: String, parentId: String?)

    @Query("UPDATE folders SET trashed = :trashed WHERE id = :id")
    suspend fun setTrashed(id: String, trashed: Boolean)

    @Query("UPDATE folders SET starred = :starred WHERE id = :id")
    suspend fun setStarred(id: String, starred: Boolean)

    @Query("DELETE FROM folders WHERE id = :id")
    suspend fun delete(id: String)

    @Query("SELECT COUNT(*) FROM folders")
    suspend fun count(): Int
}

/**
 * An outbox row the user should know about, with the name of the item it
 * touches (looked up in the local tree; null when the item is no longer there).
 */
data class OutboxIssueRow(
    val seq: Long,
    val op: String,
    val targetId: String?,
    val isFolder: Boolean,
    val payload: String,
    val state: String,
    val attempts: Int,
    val lastError: String?,
    val lastErrorClass: String?,
    val nextAttemptAt: Long,
    val createdAt: Long,
    val targetName: String?,
)

@Dao
interface OutboxDao {
    /** Every row, oldest first, whatever its state. */
    @Query("SELECT * FROM outbox ORDER BY seq")
    suspend fun all(): List<OutboxEntity>

    @Query("SELECT * FROM outbox WHERE seq = :seq")
    suspend fun get(seq: Long): OutboxEntity?

    @Query("SELECT COUNT(*) FROM outbox")
    fun pendingCount(): Flow<Int>

    @Insert
    suspend fun enqueue(entry: OutboxEntity): Long

    /** Only for a row that reached the server, or an explicit user discard. */
    @Query("DELETE FROM outbox WHERE seq = :seq")
    suspend fun remove(seq: Long)

    @Query(
        """UPDATE outbox SET state = 'pending', attempts = :attempts, nextAttemptAt = :nextAttemptAt,
                  lastError = :error, lastErrorClass = :errorClass
           WHERE seq = :seq"""
    )
    suspend fun reschedule(seq: Long, attempts: Int, nextAttemptAt: Long, error: String, errorClass: String)

    @Query(
        """UPDATE outbox SET state = 'failed', attempts = :attempts,
                  lastError = :error, lastErrorClass = :errorClass
           WHERE seq = :seq"""
    )
    suspend fun reject(seq: Long, attempts: Int, error: String, errorClass: String)

    @Query(
        """UPDATE outbox SET state = 'pending', attempts = 0, nextAttemptAt = 0,
                  lastError = NULL, lastErrorClass = NULL
           WHERE seq = :seq"""
    )
    suspend fun resetToPending(seq: Long)

    @Query(
        """UPDATE outbox SET state = 'pending', attempts = 0, nextAttemptAt = 0,
                  lastError = NULL, lastErrorClass = NULL
           WHERE state = 'failed' OR attempts > 0"""
    )
    suspend fun resetAllToPending()

    @Query("SELECT MIN(nextAttemptAt) FROM outbox WHERE state = 'pending'")
    suspend fun earliestPendingDue(): Long?

    /**
     * Not synced: refused by the server ("failed"), or still pending after at
     * least [threshold] failed attempts. Observed, so the UI follows the drain.
     */
    @Query(
        """SELECT o.seq AS seq, o.op AS op, o.targetId AS targetId, o.isFolder AS isFolder,
                  o.payload AS payload, o.state AS state, o.attempts AS attempts,
                  o.lastError AS lastError, o.lastErrorClass AS lastErrorClass,
                  o.nextAttemptAt AS nextAttemptAt, o.createdAt AS createdAt,
                  COALESCE(f.name, d.name) AS targetName
           FROM outbox o
           LEFT JOIN files f ON o.isFolder = 0 AND f.id = o.targetId
           LEFT JOIN folders d ON o.isFolder = 1 AND d.id = o.targetId
           WHERE o.state = 'failed' OR o.attempts >= :threshold
           ORDER BY o.seq"""
    )
    fun notSynced(threshold: Int): Flow<List<OutboxIssueRow>>
}

@Dao
interface TransferDao {
    @Query("SELECT * FROM transfers ORDER BY createdAt DESC")
    fun all(): Flow<List<TransferEntity>>

    @Query("SELECT * FROM transfers WHERE state IN ('queued','running') ORDER BY createdAt")
    suspend fun active(): List<TransferEntity>

    @Query("SELECT * FROM transfers WHERE id = :id")
    suspend fun byId(id: Long): TransferEntity?

    @Insert
    suspend fun enqueue(transfer: TransferEntity): Long

    @Update
    suspend fun update(transfer: TransferEntity)

    @Query("UPDATE transfers SET bytesDone = :bytes, nextChunk = :nextChunk, state = 'running' WHERE id = :id")
    suspend fun progress(id: Long, bytes: Long, nextChunk: Int)

    @Query("UPDATE transfers SET state = :state, error = :error WHERE id = :id")
    suspend fun finish(id: Long, state: String, error: String?)

    @Query("UPDATE transfers SET sessionId = :sessionId, chunkSize = :chunkSize WHERE id = :id")
    suspend fun attachSession(id: Long, sessionId: String, chunkSize: Long)

    @Query("DELETE FROM transfers WHERE state IN ('done','failed')")
    suspend fun clearFinished()

    @Query("DELETE FROM transfers WHERE id = :id")
    suspend fun remove(id: Long)
}

@Dao
interface FileDao {
    @Query(
        """SELECT * FROM files
           WHERE ((:folderId IS NULL AND folderId IS NULL) OR folderId = :folderId)
             AND trashed = 0
           ORDER BY name COLLATE NOCASE"""
    )
    fun filesIn(folderId: String?): Flow<List<FileEntity>>

    @Query("SELECT * FROM files WHERE starred = 1 AND trashed = 0 ORDER BY name COLLATE NOCASE")
    fun starred(): Flow<List<FileEntity>>

    @Query("SELECT * FROM files WHERE id = :id")
    suspend fun get(id: String): FileEntity?

    @Upsert
    suspend fun upsert(files: List<FileEntity>)

    @Query("UPDATE files SET name = :name WHERE id = :id")
    suspend fun rename(id: String, name: String)

    @Query("UPDATE files SET folderId = :folderId WHERE id = :id")
    suspend fun move(id: String, folderId: String?)

    @Query("UPDATE files SET trashed = :trashed WHERE id = :id")
    suspend fun setTrashed(id: String, trashed: Boolean)

    @Query("UPDATE files SET starred = :starred WHERE id = :id")
    suspend fun setStarred(id: String, starred: Boolean)

    @Query("DELETE FROM files WHERE id = :id")
    suspend fun delete(id: String)
}

@Dao
interface AutoUploadDao {
    @Query("SELECT 1 FROM auto_upload_ledger WHERE mediaStoreId = :id LIMIT 1")
    suspend fun hasMediaId(id: Long): Int?

    @Query("SELECT 1 FROM auto_upload_ledger WHERE contentHash = :hash LIMIT 1")
    suspend fun hasHash(hash: String): Int?

    @Upsert
    suspend fun record(entry: AutoUploadEntity)

    @Query("SELECT COUNT(1) FROM auto_upload_ledger")
    fun count(): Flow<Int>

    @Query("DELETE FROM auto_upload_ledger")
    suspend fun clear()
}

@Dao
interface PinDao {
    @Query("SELECT * FROM pins")
    fun all(): Flow<List<PinEntity>>

    @Query("SELECT fileId FROM pins")
    suspend fun pinnedIds(): List<String>

    @Query("SELECT 1 FROM pins WHERE fileId = :id LIMIT 1")
    fun isPinned(id: String): Flow<Int?>

    @Upsert
    suspend fun pin(entry: PinEntity)

    @Query("DELETE FROM pins WHERE fileId = :id")
    suspend fun unpin(id: String)

    // ---- local copies ----

    @Query("SELECT * FROM local_copies WHERE fileId = :id")
    suspend fun copyOf(id: String): LocalCopyEntity?

    @Query("SELECT * FROM local_copies")
    suspend fun allCopies(): List<LocalCopyEntity>

    @Query("SELECT COALESCE(SUM(size), 0) FROM local_copies")
    fun offlineBytes(): Flow<Long>

    @Upsert
    suspend fun recordCopy(entry: LocalCopyEntity)

    @Query("DELETE FROM local_copies WHERE fileId = :id")
    suspend fun removeCopy(id: String)

    @Query("DELETE FROM local_copies")
    suspend fun clearCopies()
}

/**
 * Queries backing the drawer destinations and search. All of them read the
 * local store, so those screens work with the radios off.
 */
@Dao
interface BrowseDao {
    @Query("SELECT * FROM files WHERE trashed = 0 ORDER BY updatedAt DESC LIMIT 200")
    fun recentFiles(): Flow<List<FileEntity>>

    @Query("SELECT * FROM files WHERE trashed = 1 ORDER BY name COLLATE NOCASE")
    fun trashedFiles(): Flow<List<FileEntity>>

    @Query("SELECT * FROM folders WHERE trashed = 1 ORDER BY name COLLATE NOCASE")
    fun trashedFolders(): Flow<List<FolderEntity>>

    @Query(
        """SELECT * FROM files
           WHERE trashed = 0 AND name LIKE '%' || :term || '%'
           ORDER BY name COLLATE NOCASE LIMIT 100"""
    )
    fun searchFiles(term: String): Flow<List<FileEntity>>

    @Query(
        """SELECT * FROM folders
           WHERE trashed = 0 AND name LIKE '%' || :term || '%'
           ORDER BY name COLLATE NOCASE LIMIT 50"""
    )
    fun searchFolders(term: String): Flow<List<FolderEntity>>

    @Query("SELECT * FROM folders WHERE parentId IS NULL AND trashed = 0 ORDER BY name COLLATE NOCASE")
    fun rootFolders(): Flow<List<FolderEntity>>
}
