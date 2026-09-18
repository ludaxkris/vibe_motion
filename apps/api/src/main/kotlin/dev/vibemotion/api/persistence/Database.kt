package dev.vibemotion.api.persistence

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import dev.vibemotion.api.config.DatabaseSettings
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.jdbc.Database
import org.slf4j.LoggerFactory
import javax.sql.DataSource

/** The `select 1` probe behind `GET /health`. Separated so the route can be tested on its own. */
fun interface DatabaseHealth {
    fun isReachable(): Boolean
}

/**
 * Owns the connection pool: runs Flyway on startup, then hands the pool to Exposed.
 * Created once in [dev.vibemotion.api.main] and closed on shutdown.
 */
class AppDatabase private constructor(
    private val dataSource: HikariDataSource,
) : DatabaseHealth,
    AutoCloseable {
    override fun isReachable(): Boolean = probe(dataSource)

    override fun close() = dataSource.close()

    companion object {
        private val log = LoggerFactory.getLogger(AppDatabase::class.java)
        private const val MAX_POOL_SIZE = 8
        private const val CONNECTION_TIMEOUT_MS = 5_000L

        /** Builds the pool, migrates, and connects Exposed. */
        fun start(settings: DatabaseSettings): AppDatabase {
            val dataSource = pool(settings)
            migrate(dataSource)
            Database.connect(dataSource)
            return AppDatabase(dataSource)
        }

        fun pool(
            settings: DatabaseSettings,
            maximumPoolSize: Int = MAX_POOL_SIZE,
            connectionTimeoutMs: Long = CONNECTION_TIMEOUT_MS,
        ): HikariDataSource {
            val config =
                HikariConfig().apply {
                    jdbcUrl = settings.jdbcUrl
                    if (settings.user.isNotBlank()) username = settings.user
                    if (settings.password.isNotBlank()) password = settings.password
                    driverClassName = "org.postgresql.Driver"
                    this.maximumPoolSize = maximumPoolSize
                    connectionTimeout = connectionTimeoutMs
                    poolName = "vibe-motion"
                    // Let the service boot (and report db: down) instead of dying when Postgres
                    // is briefly unavailable.
                    initializationFailTimeout = -1
                }
            return HikariDataSource(config)
        }

        fun migrate(dataSource: DataSource) {
            val applied =
                Flyway
                    .configure()
                    .dataSource(dataSource)
                    .locations("classpath:db/migration")
                    .load()
                    .migrate()
            log.info("Flyway applied {} migration(s), schema at {}", applied.migrationsExecuted, applied.targetSchemaVersion)
        }

        /** Runs `select 1`; any failure means the dependency is down, never a 500. */
        fun probe(dataSource: DataSource): Boolean =
            runCatching {
                dataSource.connection.use { connection ->
                    connection.createStatement().use { statement ->
                        statement.executeQuery("select 1").use { rows -> rows.next() }
                    }
                }
            }.getOrElse { failure ->
                log.warn("Database health probe failed: {}", failure.message)
                false
            }
    }
}
