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
    ],
    version = 2,
    exportSchema = false,
)
abstract class KubunoDatabase : RoomDatabase() {
    abstract fun metaDao(): MetaDao
    abstract fun folderDao(): FolderDao
    abstract fun fileDao(): FileDao
    abstract fun outboxDao(): OutboxDao
    abstract fun transferDao(): TransferDao
}
