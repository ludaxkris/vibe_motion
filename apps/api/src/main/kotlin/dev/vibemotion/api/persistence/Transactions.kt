package dev.vibemotion.api.persistence

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.transactions.suspendTransaction

/**
 * One unit of work.
 *
 * Repository calls are only meaningful inside [transactional]: the Exposed repositories read the
 * ambient transaction rather than opening their own, which is what lets a service group "lock the
 * project, append the version, move the pointer" into a single atomic step. Services depend on this
 * interface so the transaction boundary is theirs to choose without importing Exposed.
 */
interface TransactionRunner {
    suspend fun <T> transactional(block: () -> T): T
}

/**
 * Exposed over blocking JDBC. The body runs on [Dispatchers.IO] so a Ktor request thread is never
 * parked on a socket read or on a row lock held by another save.
 */
class ExposedTransactionRunner(
    private val database: Database? = null,
) : TransactionRunner {
    override suspend fun <T> transactional(block: () -> T): T = withContext(Dispatchers.IO) { suspendTransaction(database) { block() } }
}
