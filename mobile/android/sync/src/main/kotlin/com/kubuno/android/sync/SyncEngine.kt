package com.kubuno.android.sync

import androidx.room.withTransaction
import com.kubuno.android.api.KubunoClient
import com.kubuno.android.api.model.DriveChange
import com.kubuno.android.sync.db.FileEntity
import com.kubuno.android.sync.db.FolderEntity
import com.kubuno.android.sync.db.KubunoDatabase
import com.kubuno.android.sync.db.MetaEntity
import java.io.IOException

/**
 * Pull side of the sync: drains the drive's cursor-based delta feed into Room.
 *
 * Mirrors the desktop engine's discipline (desktop/crates/kubuno-sync/src/engine.rs):
 * each page is applied in three passes (folders -> files -> tombstones) inside
 * ONE Room transaction that also persists the new cursor, so an interrupted
 * sync can always resume from a consistent point.
 */
class SyncEngine(
    private val db: KubunoDatabase,
    private val client: KubunoClient,
) {
    companion object {
        private const val CURSOR_KEY = "cursor"
        private const val PAGE_LIMIT = 2000
    }

    suspend fun pull() {
        var cursor = db.metaDao().get(CURSOR_KEY)?.toLongOrNull() ?: 0L
        while (true) {
            val response = client.driveApi.delta(cursor = cursor, limit = PAGE_LIMIT)
            if (!response.isSuccessful) throw IOException("delta failed (${response.code()})")
            val delta = response.body() ?: throw IOException("delta returned no body")

            db.withTransaction {
                applyPage(delta.changes)
                db.metaDao().set(MetaEntity(CURSOR_KEY, delta.cursor.toString()))
            }
            cursor = delta.cursor
            if (!delta.hasMore || delta.changes.isEmpty()) break
        }
    }

    private suspend fun applyPage(changes: List<DriveChange>) {
        // Pass 1: folders, so file parents exist before files reference them.
        val folders = changes.filter { it.kind == "folder" }.map { it.toFolderEntity() }
        if (folders.isNotEmpty()) db.folderDao().upsert(folders)

        // Pass 2: files.
        val files = changes.filter { it.kind == "file" }.map { it.toFileEntity() }
        if (files.isNotEmpty()) db.fileDao().upsert(files)

        // Pass 3: tombstones — hard deletes by target kind.
        changes.filter { it.kind == "deleted" }.forEach { change ->
            when (change.target) {
                "folder" -> db.folderDao().delete(change.id)
                else -> db.fileDao().delete(change.id)
            }
        }
    }
}

private fun DriveChange.toFolderEntity(): FolderEntity = FolderEntity(
    id = id,
    parentId = folder?.parentId ?: parentId,
    name = folder?.name ?: name.orEmpty(),
    path = folder?.path ?: path.orEmpty(),
    starred = folder?.isStarred ?: false,
    trashed = folder?.isTrashed ?: trashed,
    color = folder?.color,
    updatedAt = folder?.updatedAt,
    changeSeq = changeSeq,
)

private fun DriveChange.toFileEntity(): FileEntity = FileEntity(
    id = id,
    folderId = file?.folderId ?: folderId,
    name = file?.name ?: name.orEmpty(),
    mimeType = file?.mimeType ?: mimeType,
    size = file?.sizeBytes ?: size ?: 0,
    etag = file?.contentHash ?: etag,
    starred = file?.isStarred ?: false,
    trashed = file?.isTrashed ?: trashed,
    hasThumbnail = file?.hasThumbnail ?: false,
    updatedAt = file?.updatedAt,
    changeSeq = changeSeq,
)
