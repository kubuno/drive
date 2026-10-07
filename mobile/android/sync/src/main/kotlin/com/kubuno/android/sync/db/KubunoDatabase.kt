package com.kubuno.android.sync.db

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

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
    version = 4,
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

    companion object {
        /**
         * 3 -> 4: the outbox never gives an intent up. Adds the persisted
         * schedule (state, nextAttemptAt) and the class of the last failure.
         * Existing rows become pending and due now, so whatever was queued
         * before the upgrade is replayed rather than lost.
         *
         * The defaults must match the entity's @ColumnInfo(defaultValue), or
         * Room's schema validation rejects the migrated table.
         */
        val MIGRATION_3_4: Migration = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE outbox ADD COLUMN state TEXT NOT NULL DEFAULT 'pending'")
                db.execSQL("ALTER TABLE outbox ADD COLUMN nextAttemptAt INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE outbox ADD COLUMN lastErrorClass TEXT")
            }
        }

        /** Every migration, in order; schemas before 3 were pre-release caches. */
        val MIGRATIONS: Array<Migration> = arrayOf(MIGRATION_3_4)
    }
}
