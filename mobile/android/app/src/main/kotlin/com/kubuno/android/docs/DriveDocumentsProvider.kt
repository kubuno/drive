package com.kubuno.android.docs

import android.database.Cursor
import android.database.MatrixCursor
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract.Document
import android.provider.DocumentsContract.Root
import android.provider.DocumentsProvider
import com.kubuno.android.R
import com.kubuno.android.account.AccountGraph
import com.kubuno.android.account.ActiveAccount
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

/**
 * Exposes the signed-in account's drive as a storage location in Android's file
 * picker and Files app — what makes the system recognise Kubuno as a files app.
 *
 * The tree is read from the same Room cache the app already syncs, so browsing
 * is offline and instant; a file is downloaded on demand when another app opens
 * it. Read-only for now: pickers can browse and open, not write back.
 *
 * The provider is instantiated by the system, not Hilt, so it pulls its
 * dependencies through an [EntryPoint]. Its methods run on binder threads where
 * blocking is allowed, hence the runBlocking around the suspend DAO calls.
 */
class DriveDocumentsProvider : DocumentsProvider() {

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface Deps {
        fun activeAccount(): ActiveAccount
    }

    private val active: ActiveAccount by lazy {
        EntryPointAccessors.fromApplication(context!!.applicationContext, Deps::class.java)
            .activeAccount()
    }

    override fun onCreate(): Boolean = true

    private fun graph(): AccountGraph? = active.graph.value

    override fun queryRoots(projection: Array<out String>?): Cursor {
        val cursor = MatrixCursor(projection ?: DEFAULT_ROOT_PROJECTION)
        val graph = graph() ?: return cursor // no account yet → no root
        cursor.newRow().apply {
            add(Root.COLUMN_ROOT_ID, ROOT_ID)
            add(Root.COLUMN_DOCUMENT_ID, ROOT_DOC)
            add(Root.COLUMN_TITLE, "Kubuno Drive")
            add(Root.COLUMN_SUMMARY, graph.record.email ?: graph.record.label)
            add(Root.COLUMN_FLAGS, Root.FLAG_SUPPORTS_IS_CHILD)
            add(Root.COLUMN_ICON, R.mipmap.ic_launcher)
            add(Root.COLUMN_MIME_TYPES, "*/*")
        }
        return cursor
    }

    override fun queryDocument(documentId: String, projection: Array<out String>?): Cursor {
        val cursor = MatrixCursor(projection ?: DEFAULT_DOC_PROJECTION)
        val graph = graph() ?: return cursor
        when {
            documentId == ROOT_DOC -> cursor.addFolder(ROOT_DOC, "Kubuno Drive")
            documentId.startsWith(FOLDER_PREFIX) -> {
                val id = documentId.removePrefix(FOLDER_PREFIX)
                val folder = runBlocking { graph.db.folderDao().get(id) }
                if (folder != null) cursor.addFolder(documentId, folder.name)
            }
            documentId.startsWith(FILE_PREFIX) -> {
                val id = documentId.removePrefix(FILE_PREFIX)
                val file = runBlocking { graph.db.fileDao().get(id) }
                if (file != null) cursor.addFile(documentId, file.name, file.mimeType, file.size)
            }
        }
        return cursor
    }

    override fun queryChildDocuments(
        parentDocumentId: String,
        projection: Array<out String>?,
        sortOrder: String?,
    ): Cursor {
        val cursor = MatrixCursor(projection ?: DEFAULT_DOC_PROJECTION)
        val graph = graph() ?: return cursor
        val parentId = when {
            parentDocumentId == ROOT_DOC -> null
            parentDocumentId.startsWith(FOLDER_PREFIX) -> parentDocumentId.removePrefix(FOLDER_PREFIX)
            else -> return cursor
        }
        runBlocking {
            graph.db.folderDao().children(parentId).first().forEach { folder ->
                cursor.addFolder(FOLDER_PREFIX + folder.id, folder.name)
            }
            graph.db.fileDao().filesIn(parentId).first().forEach { file ->
                cursor.addFile(FILE_PREFIX + file.id, file.name, file.mimeType, file.size)
            }
        }
        return cursor
    }

    override fun openDocument(
        documentId: String,
        mode: String,
        signal: CancellationSignal?,
    ): ParcelFileDescriptor {
        val graph = graph() ?: throw IllegalStateException("Aucun compte")
        require(documentId.startsWith(FILE_PREFIX)) { "Not a file: $documentId" }
        val fileId = documentId.removePrefix(FILE_PREFIX)
        // Downloads (or reuses the pinned copy); binder thread, blocking is fine.
        val file = runBlocking { graph.offline.cacheForViewing(fileId) }
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    private fun MatrixCursor.addFolder(documentId: String, name: String) {
        newRow().apply {
            add(Document.COLUMN_DOCUMENT_ID, documentId)
            add(Document.COLUMN_DISPLAY_NAME, name)
            add(Document.COLUMN_MIME_TYPE, Document.MIME_TYPE_DIR)
            add(Document.COLUMN_FLAGS, 0)
            add(Document.COLUMN_SIZE, null)
        }
    }

    private fun MatrixCursor.addFile(documentId: String, name: String, mime: String?, size: Long) {
        newRow().apply {
            add(Document.COLUMN_DOCUMENT_ID, documentId)
            add(Document.COLUMN_DISPLAY_NAME, name)
            add(Document.COLUMN_MIME_TYPE, mime?.takeIf { it.isNotBlank() } ?: "application/octet-stream")
            add(Document.COLUMN_SIZE, size)
            add(Document.COLUMN_FLAGS, 0)
        }
    }

    private companion object {
        const val ROOT_ID = "kubuno-drive"
        const val ROOT_DOC = "root"
        const val FOLDER_PREFIX = "d/"
        const val FILE_PREFIX = "f/"

        val DEFAULT_ROOT_PROJECTION = arrayOf(
            Root.COLUMN_ROOT_ID, Root.COLUMN_DOCUMENT_ID, Root.COLUMN_TITLE,
            Root.COLUMN_SUMMARY, Root.COLUMN_FLAGS, Root.COLUMN_ICON, Root.COLUMN_MIME_TYPES,
        )
        val DEFAULT_DOC_PROJECTION = arrayOf(
            Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME,
            Document.COLUMN_MIME_TYPE, Document.COLUMN_SIZE, Document.COLUMN_FLAGS,
        )
    }
}
