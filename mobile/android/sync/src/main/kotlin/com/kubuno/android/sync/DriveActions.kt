package com.kubuno.android.sync

import com.kubuno.android.sync.db.FolderEntity
import com.kubuno.android.sync.db.KubunoDatabase
import com.kubuno.android.sync.db.OutboxEntity
import com.kubuno.android.sync.work.SyncScheduler
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Operation names carried in [OutboxEntity.op]. */
object Ops {
    const val RENAME = "rename"
    const val MOVE = "move"
    const val TRASH = "trash"
    const val RESTORE = "restore"
    const val STAR = "star"
    const val MKDIR = "mkdir"
}

/**
 * User-facing drive mutations.
 *
 * Each call writes the change to Room immediately — the UI reads Room, so it
 * reacts at once — and queues the request in the outbox. The sync worker
 * drains the queue before pulling the delta, which then reconciles whatever
 * the server actually did (it may, for instance, rename to "name (2)").
 */
@Singleton
class DriveActions @Inject constructor(
    private val db: KubunoDatabase,
    private val scheduler: SyncScheduler,
) {
    private val json = Json

    suspend fun rename(id: String, isFolder: Boolean, newName: String) {
        if (isFolder) db.folderDao().rename(id, newName) else db.fileDao().rename(id, newName)
        enqueue(Ops.RENAME, id, isFolder, buildJsonObject { put("name", newName) })
    }

    suspend fun move(id: String, isFolder: Boolean, targetFolderId: String?) {
        if (isFolder) db.folderDao().move(id, targetFolderId) else db.fileDao().move(id, targetFolderId)
        enqueue(Ops.MOVE, id, isFolder, buildJsonObject { put("target", targetFolderId) })
    }

    suspend fun trash(id: String, isFolder: Boolean) {
        if (isFolder) db.folderDao().setTrashed(id, true) else db.fileDao().setTrashed(id, true)
        enqueue(Ops.TRASH, id, isFolder, JsonObject(emptyMap()))
    }

    suspend fun restore(id: String, isFolder: Boolean) {
        if (isFolder) db.folderDao().setTrashed(id, false) else db.fileDao().setTrashed(id, false)
        enqueue(Ops.RESTORE, id, isFolder, JsonObject(emptyMap()))
    }

    /**
     * Starring is a server-side toggle with no way to request an absolute
     * state, so the desired value travels with the entry and the drain skips
     * the call when the server already agrees.
     */
    suspend fun setStarred(id: String, isFolder: Boolean, starred: Boolean) {
        if (isFolder) db.folderDao().setStarred(id, starred) else db.fileDao().setStarred(id, starred)
        enqueue(Ops.STAR, id, isFolder, buildJsonObject { put("starred", starred) })
    }

    /**
     * Creates the folder locally with a client-minted id; the server honours
     * that id, so the row stays valid once the request lands and nothing has
     * to be rewritten afterwards.
     */
    suspend fun createFolder(parentId: String?, name: String): String {
        val id = UUID.randomUUID().toString()
        val parentPath = parentId?.let { db.folderDao().get(it)?.path } ?: ""
        db.folderDao().upsertOne(
            FolderEntity(
                id = id,
                parentId = parentId,
                name = name,
                path = "$parentPath/$name",
                starred = false,
                trashed = false,
                color = null,
                updatedAt = null,
                changeSeq = 0,
            )
        )
        enqueue(
            Ops.MKDIR, id, isFolder = true,
            payload = buildJsonObject {
                put("name", name)
                put("parent", parentId)
            },
        )
        return id
    }

    private suspend fun enqueue(op: String, targetId: String, isFolder: Boolean, payload: JsonObject) {
        db.outboxDao().enqueue(
            OutboxEntity(
                idempotencyKey = UUID.randomUUID().toString(),
                op = op,
                targetId = targetId,
                isFolder = isFolder,
                payload = json.encodeToString(JsonObject.serializer(), payload),
                createdAt = System.currentTimeMillis(),
            )
        )
        scheduler.syncNow()
    }
}
