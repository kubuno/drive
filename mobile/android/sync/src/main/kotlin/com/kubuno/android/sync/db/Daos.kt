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

@Dao
interface OutboxDao {
    @Query("SELECT * FROM outbox ORDER BY seq")
    suspend fun pending(): List<OutboxEntity>

    @Query("SELECT COUNT(*) FROM outbox")
    fun pendingCount(): Flow<Int>

    @Insert
    suspend fun enqueue(entry: OutboxEntity): Long

    @Query("DELETE FROM outbox WHERE seq = :seq")
    suspend fun remove(seq: Long)

    @Query("UPDATE outbox SET attempts = attempts + 1, lastError = :error WHERE seq = :seq")
    suspend fun markFailed(seq: Long, error: String?)
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
