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
