package com.kubuno.android.sync.db

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [
        MetaEntity::class,
        FolderEntity::class,
        FileEntity::class,
        OutboxEntity::class,
        TransferEntity::class,
        AutoUploadEntity::class,
        PinEntity::class,
        LocalCopyEntity::class,
    ],
    version = 3,
    exportSchema = false,
)
abstract class KubunoDatabase : RoomDatabase() {
    abstract fun metaDao(): MetaDao
    abstract fun folderDao(): FolderDao
    abstract fun fileDao(): FileDao
    abstract fun outboxDao(): OutboxDao
    abstract fun transferDao(): TransferDao
    abstract fun autoUploadDao(): AutoUploadDao
    abstract fun pinDao(): PinDao
    abstract fun browseDao(): BrowseDao
}
