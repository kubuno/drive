package com.kubuno.android.di

import android.content.Context
import com.kubuno.android.api.AuthApi
import com.kubuno.android.api.KubunoClient
import com.kubuno.android.api.auth.TokenManager
import com.kubuno.android.api.auth.TokenStore
import com.kubuno.android.api.net.DeviceKeyProvider
import com.kubuno.android.data.AppPrefs
import com.kubuno.android.secure.FileTokenStore
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun providePrefs(@ApplicationContext context: Context): AppPrefs = AppPrefs(context)

    @Provides
    @Singleton
    fun provideTokenStore(@ApplicationContext context: Context): TokenStore =
        FileTokenStore(context)

    @Provides
    @Singleton
    fun provideKubunoClient(prefs: AppPrefs, tokenStore: TokenStore): KubunoClient =
        KubunoClient(
            tokenStore = tokenStore,
            deviceKeyProvider = DeviceKeyProvider { prefs.deviceKey },
            initialBaseUrl = prefs.serverUrl,
        )

    @Provides
    @Singleton
    fun provideTokenManager(client: KubunoClient): TokenManager = client.tokenManager

    @Provides
    @Singleton
    fun provideAuthApi(client: KubunoClient): AuthApi = client.authApi
}
