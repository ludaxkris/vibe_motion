package dev.vibemotion.api.persistence

import dev.vibemotion.api.domain.ProjectBusyException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.transactions.suspendTransaction
import java.sql.SQLException

/**
 * One unit of work.
 *
 * Repository calls are only meaningful inside [transactional]: the Exposed repositories read the
 * ambient transaction rather than opening their own, which is what lets a service group "lock the
 * project, append the version, move the pointer" into a single atomic step. Services depend on this
 * interface so the transaction boundary is theirs to choose without importing Exposed.
 *
 * ## Recorded decisions
 *
 * **[block] is deliberately NOT a suspending function.** A JDBC transaction is bound to the thread
 * that opened it, so a suspension point inside one could resume on another thread and leave the
 * connection behind; and a non-suspending body cannot contain a network call, so nobody can
 * accidentally hold the project row lock across an HTTP fetch. Both mistakes are easy to make and
 * expensive to find, and this signature makes neither of them expressible. The clone fetch happens
 * before the transaction opens for exactly the same reason.
 *
 * **Isolation is Postgres' default, READ COMMITTED.** Nothing raises it, and the save path does not
 * need it raised: correctness rests on `select ... for update` (see
 * [dev.vibemotion.api.projects.ProjectRepository.findForUpdate]). Under READ COMMITTED a
 * transaction blocked on a row lock re-reads the row once the holder commits, so the loser of a
 * save race sees the winner's `current_version_id` and answers 409 rather than forking history. If
 * isolation is ever raised to REPEATABLE READ the loser gets a serialisation failure (40001)
 * instead, which Exposed retries and which then 409s — still correct, but the row lock is what is
 * load-bearing today.
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
    override suspend fun <T> transactional(block: () -> T): T =
        withContext(Dispatchers.IO) {
            try {
                suspendTransaction(database) { block() }
            } catch (failure: Exception) {
                throw failure.asProjectBusy() ?: failure
            }
        }
}

/** Postgres `lock_not_available`: a `SET LOCAL lock_timeout` fired while waiting for a row lock. */
private const val LOCK_NOT_AVAILABLE = "55P03"

/**
 * The lock timeout, translated at the only layer that knows about JDBC.
 *
 * Exposed wraps driver failures, and the driver's own exception can itself be chained, so the
 * whole cause chain is searched. The only `for update` in this service is the project row, which
 * is why a lock timeout maps to a project-level "busy".
 */
internal fun Throwable.asProjectBusy(): ProjectBusyException? {
    val seen = mutableSetOf<Throwable>()
    var current: Throwable? = this
    while (current != null && seen.add(current)) {
        if (current is SQLException && current.sqlState == LOCK_NOT_AVAILABLE) {
            return ProjectBusyException(
                "Another save or restore is holding this project; retry in a moment",
                cause = current,
            )
        }
        current = current.cause
    }
    return null
}
