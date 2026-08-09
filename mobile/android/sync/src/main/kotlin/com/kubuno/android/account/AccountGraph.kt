package com.kubuno.android.account

import android.content.Context
import androidx.room.Room
import androidx.work.WorkManager
import com.kubuno.android.api.KubunoClient
import com.kubuno.android.api.SharedHttp
import com.kubuno.android.api.auth.TokenStore
import com.kubuno.android.data.AccountPrefs
import com.kubuno.android.data.AppPrefs
import com.kubuno.android.sync.DriveActions
import com.kubuno.android.sync.OfflineFiles
import com.kubuno.android.sync.OutboxDrain
import com.kubuno.android.sync.SyncEngine
import com.kubuno.android.sync.db.KubunoDatabase
import com.kubuno.android.sync.realtime.DriveEventsClient
import com.kubuno.android.sync.transfer.TransferQueue
import com.kubuno.android.sync.work.SyncScheduler
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Everything that belongs to one account, built once and kept together.
 *
 * These used to be application singletons, which silently meant "whatever
 * account happens to be current" — a sync could drain one account's outbox
 * against another's server. Grouping them per account makes the ownership
 * explicit and lets several accounts run at the same time.
 */
class AccountGraph(
    val id: AccountId,
    private val registry: AccountRegistry,
    val client: KubunoClient,
    val db: KubunoDatabase,
    val prefs: AccountPrefs,
    val engine: SyncEngine,
    val outbox: OutboxDrain,
    val actions: DriveActions,
    val offline: OfflineFiles,
    val transfers: TransferQueue,
    val events: DriveEventsClient,
    val scheduler: SyncScheduler,
) {
    /**
     * Read through the registry rather than captured: a /me refresh updates the
     * registration, and a graph holding a snapshot would keep showing the old
     * name and avatar until it was rebuilt.
     */
    val record: AccountRecord get() = registry.get(id) ?: fallback

    /** Last known values, so a removed account still renders while tearing down. */
    private var fallback: AccountRecord = registry.get(id)!!
    /** Releases sockets and closes the database; the data stays on disk. */
    fun close() {
        events.stop()
        client.shutdown()
        db.close()
    }
}

/**
 * Builds and caches one [AccountGraph] per account.
 *
 * Workers get their dependencies injected before they can read their input,
 * so they inject this factory instead and resolve the graph from the account
 * id carried in their input data.
 */
@Singleton
class AccountGraphFactory @Inject constructor(
    @ApplicationContext private val context: Context,
    private val registry: AccountRegistry,
    private val appPrefs: AppPrefs,
    private val workManager: WorkManager,
    private val tokenStores: TokenStoreFactory,
) {
    private val shared = SharedHttp()
    private val graphs = ConcurrentHashMap<String, AccountGraph>()

    fun graphOf(id: AccountId): AccountGraph? {
        graphs[id.value]?.let { return it }
        val record = registry.get(id) ?: return null
        return graphs.computeIfAbsent(id.value) { build(record) }
    }

    fun active(): AccountGraph? = registry.activeId.value?.let(::graphOf)

    fun all(): List<AccountGraph> = registry.accounts.value.mapNotNull { graphOf(it.id) }

    /** Drops the graph and erases everything the account owned on disk. */
    fun forget(id: AccountId) {
        graphs.remove(id.value)?.close()
        context.deleteDatabase(dbName(id))
        File(context.filesDir, "sessions/${id.value}.bin").delete()
        File(context.filesDir, "offline/${id.value}").deleteRecursively()
        File(context.filesDir, "downloads/${id.value}").deleteRecursively()
        AccountPrefs(context, id).erase()
    }

    private fun build(record: AccountRecord): AccountGraph {
        val client = KubunoClient(
            baseUrl = record.serverUrl,
            tokenStore = tokenStores.create(record.id),
            deviceKeyProvider = { appPrefs.deviceKey },
            shared = shared,
        )
        val db = Room.databaseBuilder(context, KubunoDatabase::class.java, dbName(record.id))
            // Pre-release schema: recreating one account's cache is cheap, and
            // the outbox is drained before any migration would matter.
            .fallbackToDestructiveMigration(dropAllTables = true)
            .build()
        val prefs = AccountPrefs(context, record.id)
        val offline = OfflineFiles(context, record.id, db, client)
        val engine = SyncEngine(db, client)
        val outbox = OutboxDrain(db, client)
        val scheduler = SyncScheduler(workManager, record.id)
        val actions = DriveActions(db, scheduler)
        val transfers = TransferQueue(context, record.id, db, workManager)
        val events = DriveEventsClient(client)
        return AccountGraph(
            id = record.id,
            registry = registry,
            client = client,
            db = db,
            prefs = prefs,
            engine = engine,
            outbox = outbox,
            actions = actions,
            offline = offline,
            transfers = transfers,
            events = events,
            scheduler = scheduler,
        )
    }

    private fun dbName(id: AccountId) = "kubuno-${id.value}.db"
}

/** Lets :core-sync build per-account stores without depending on :app. */
fun interface TokenStoreFactory {
    fun create(id: AccountId): TokenStore
}
