package com.kubuno.android.sync.db

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [MetaEntity::class, FolderEntity::class, FileEntity::class],
    version = 1,
    exportSchema = false,
)
abstract class KubunoDatabase : RoomDatabase() {
    abstract fun metaDao(): MetaDao
    abstract fun folderDao(): FolderDao
    abstract fun fileDao(): FileDao
}
