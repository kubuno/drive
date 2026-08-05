package com.kubuno.android.di

import android.content.Context
import androidx.room.Room
import androidx.work.WorkManager
import com.kubuno.android.sync.db.KubunoDatabase
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object SyncModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): KubunoDatabase =
        Room.databaseBuilder(context, KubunoDatabase::class.java, "kubuno.db")
            // Schema v1 pre-release: recreate rather than migrate until 1.0.
            .fallbackToDestructiveMigration(dropAllTables = true)
            .build()

    @Provides
    @Singleton
    fun provideWorkManager(@ApplicationContext context: Context): WorkManager =
        WorkManager.getInstance(context)
}
