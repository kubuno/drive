package com.kubuno.android.sync.outbox

import com.kubuno.android.sync.db.OutboxDao
import com.kubuno.android.sync.db.OutboxEntity

/** [OutboxStore] over the account's Room database. */
class RoomOutboxStore(private val dao: OutboxDao) : OutboxStore {
    override suspend fun all(): List<OutboxEntity> = dao.all()

    override suspend fun get(seq: Long): OutboxEntity? = dao.get(seq)

    override suspend fun remove(seq: Long) = dao.remove(seq)

    override suspend fun reschedule(
        seq: Long,
        attempts: Int,
        nextAttemptAt: Long,
        error: String,
        errorClass: String,
    ) = dao.reschedule(seq, attempts, nextAttemptAt, error, errorClass)

    override suspend fun reject(seq: Long, attempts: Int, error: String, errorClass: String) =
        dao.reject(seq, attempts, error, errorClass)

    override suspend fun resetToPending(seq: Long) = dao.resetToPending(seq)

    override suspend fun resetAllToPending() = dao.resetAllToPending()

    override suspend fun earliestPendingDue(): Long? = dao.earliestPendingDue()
}
