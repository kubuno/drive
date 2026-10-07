package com.kubuno.android.di

import android.content.Context
import androidx.work.WorkManager
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Only what is genuinely device-wide lives here.
 *
 * The HTTP client, the database and the sync engines used to be singletons,
 * which silently meant "whichever account is current". They are now built per
 * account by `AccountGraphFactory` over the shared `AccountClients`, so nothing
 * account-shaped is provided at this level. `AppPrefs` and the per-account
 * stores are `@Inject`-constructed in `:core-account`.
 */
@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideWorkManager(@ApplicationContext context: Context): WorkManager =
        WorkManager.getInstance(context)
}
