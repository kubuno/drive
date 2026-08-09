package com.kubuno.android

import android.app.Application
import android.content.Context
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import com.kubuno.android.account.AccountCallFactory
import com.kubuno.android.account.AccountManagerBridge
import com.kubuno.android.sync.SyncCoordinator
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class KubunoApp : Application(), Configuration.Provider, SingletonImageLoader.Factory {

    @Inject lateinit var workerFactory: HiltWorkerFactory
    @Inject lateinit var syncCoordinator: SyncCoordinator
    @Inject lateinit var accountBridge: AccountManagerBridge
    @Inject lateinit var callFactory: AccountCallFactory

    override fun onCreate() {
        super.onCreate()
        syncCoordinator.install()
        // Keep the system accounts in step with ours, so sibling Kubuno apps
        // see the same list this app shows.
        accountBridge.install()
    }

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

    /** Coil rides each account's authenticated client, chosen per URL. */
    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components {
                add(OkHttpNetworkFetcherFactory(callFactory = { callFactory }))
            }
            .build()
}
