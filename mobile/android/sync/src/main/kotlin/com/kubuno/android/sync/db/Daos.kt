package com.kubuno.android.sync.db

import androidx.room.Dao
import androidx.room.Query
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

    @Upsert
    suspend fun upsert(folders: List<FolderEntity>)

    @Query("DELETE FROM folders WHERE id = :id")
    suspend fun delete(id: String)

    @Query("SELECT COUNT(*) FROM folders")
    suspend fun count(): Int
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

    @Upsert
    suspend fun upsert(files: List<FileEntity>)

    @Query("DELETE FROM files WHERE id = :id")
    suspend fun delete(id: String)
}
