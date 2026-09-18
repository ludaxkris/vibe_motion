package dev.vibemotion.api.persistence

import dev.vibemotion.api.config.DatabaseSettings
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.shouldBe

/**
 * Configuration-only checks for the startup path. Nothing here talks to Postgres: the pool is
 * pointed at a closed port and is never asked for a connection.
 */
class DatabaseTest :
    FunSpec({

        fun unreachablePool() =
            AppDatabase.pool(
                DatabaseSettings("jdbc:postgresql://127.0.0.1:1/vibe_motion", "nobody", "nobody"),
                maximumPoolSize = 1,
                connectionTimeoutMs = 250,
            )

        test("constructing the pool never probes the database, so a slow Postgres cannot kill boot") {
            // initializationFailTimeout = -1: a connection failure surfaces on first use, not here.
            unreachablePool().use { pool ->
                pool.isClosed shouldBe false
            }
        }

        test("Flyway waits for Postgres rather than crash-looping the service") {
            // migrate() runs on the fatal startup path. Flyway's default is connectRetries = 0,
            // so a Postgres that is a few seconds behind the service on a cold deploy would kill
            // the container, and the platform would restart it straight back into the same race.
            unreachablePool().use { pool ->
                val configuration = AppDatabase.flywayConfiguration(pool)

                configuration.connectRetries shouldBe 30
                configuration.connectRetriesInterval shouldBe 2
                // ~60s of patience before startup is allowed to fail.
                configuration.connectRetries * configuration.connectRetriesInterval shouldBe 60
            }
        }
    })
