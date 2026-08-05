package com.kubuno.android.sync

/**
 * M2 will bring the Room database (folders/files/outbox/transfers), the delta
 * sync engine and the WorkManager workers here. Kept as a module from day one
 * so the dependency direction (:app -> :core-sync -> :core-api) is fixed.
 */
object SyncModuleMarker
