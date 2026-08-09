package com.kubuno.android.di

import android.content.Context
import androidx.work.WorkManager
import com.kubuno.android.account.TokenStoreFactory
import com.kubuno.android.data.AppPrefs
import com.kubuno.android.secure.AccountTokenStore
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
 * account by `AccountGraphFactory`, so nothing account-shaped is provided at
 * this level.
 */
@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun providePrefs(@ApplicationContext context: Context): AppPrefs = AppPrefs(context)

    @Provides
    @Singleton
    fun provideWorkManager(@ApplicationContext context: Context): WorkManager =
        WorkManager.getInstance(context)

    /**
     * Lets :core-sync build a per-account encrypted store without depending on
     * :app, where the Keystore code lives.
     */
    @Provides
    @Singleton
    fun provideTokenStoreFactory(@ApplicationContext context: Context): TokenStoreFactory =
        TokenStoreFactory { id -> AccountTokenStore(context, id) }
}
