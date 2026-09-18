package dev.vibemotion.api.config

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.shouldBe

class AppConfigTest :
    FunSpec({

        test("converts a Render style postgresql:// URL into JDBC coordinates") {
            val settings = AppConfig.parseDatabaseUrl("postgresql://vibe_motion:s3cret@db.example.com:5432/vibe_motion")

            settings.jdbcUrl shouldBe "jdbc:postgresql://db.example.com:5432/vibe_motion"
            settings.user shouldBe "vibe_motion"
            settings.password shouldBe "s3cret"
        }

        test("defaults the port to 5432 when the URL omits it") {
            AppConfig.parseDatabaseUrl("postgres://user:pw@db.internal/vibe_motion").jdbcUrl shouldBe
                "jdbc:postgresql://db.internal:5432/vibe_motion"
        }

        test("keeps query parameters such as sslmode") {
            AppConfig.parseDatabaseUrl("postgresql://user:pw@db.internal:5432/vibe_motion?sslmode=require").jdbcUrl shouldBe
                "jdbc:postgresql://db.internal:5432/vibe_motion?sslmode=require"
        }

        test("percent-decodes credentials") {
            val settings = AppConfig.parseDatabaseUrl("postgresql://vibe%40motion:p%40ss%3Aword@db.internal:5432/vibe_motion")

            settings.user shouldBe "vibe@motion"
            settings.password shouldBe "p@ss:word"
        }

        test("tolerates a URL with no credentials") {
            val settings = AppConfig.parseDatabaseUrl("postgresql://localhost:5432/vibe_motion")

            settings.user shouldBe ""
            settings.password shouldBe ""
        }

        test("passes a jdbc: URL through untouched") {
            AppConfig.parseDatabaseUrl("jdbc:postgresql://localhost:5432/vibe_motion").jdbcUrl shouldBe
                "jdbc:postgresql://localhost:5432/vibe_motion"
        }

        test("rejects a non-postgres scheme") {
            shouldThrow<IllegalArgumentException> { AppConfig.parseDatabaseUrl("mysql://user:pw@localhost:3306/vibe") }
        }

        test("rejects a URL without a database name") {
            shouldThrow<IllegalArgumentException> { AppConfig.parseDatabaseUrl("postgresql://user:pw@localhost:5432") }
        }

        test("applies the documented defaults") {
            val env = mapOf("DATABASE_URL" to "postgresql://u:p@localhost:5432/vibe_motion")

            val config = AppConfig.fromEnv { env[it] }

            config.port shouldBe AppConfig.DEFAULT_PORT
            config.webOrigin shouldBe AppConfig.DEFAULT_WEB_ORIGIN
            config.cloneMaxBytes shouldBe AppConfig.DEFAULT_CLONE_MAX_BYTES
            config.cloneTimeoutMs shouldBe AppConfig.DEFAULT_CLONE_TIMEOUT_MS
            config.appVersion shouldBe "dev"
        }

        test("reads overrides from the environment") {
            val env =
                mapOf(
                    "DATABASE_URL" to "postgresql://u:p@localhost:5432/vibe_motion",
                    "PORT" to "9090",
                    "WEB_ORIGIN" to "https://vibe-motion-web.onrender.com",
                    "CLONE_MAX_BYTES" to "123",
                    "CLONE_TIMEOUT_MS" to "456",
                    "APP_VERSION" to "abc1234",
                )

            val config = AppConfig.fromEnv { env[it] }

            config.port shouldBe 9090
            config.webOrigin shouldBe "https://vibe-motion-web.onrender.com"
            config.cloneMaxBytes shouldBe 123L
            config.cloneTimeoutMs shouldBe 456L
            config.appVersion shouldBe "abc1234"
        }

        test("fails fast when DATABASE_URL is missing") {
            shouldThrow<IllegalStateException> { AppConfig.fromEnv { null } }
        }

        test("fails fast when a numeric variable is not a number") {
            val env = mapOf("DATABASE_URL" to "postgresql://u:p@localhost:5432/vibe_motion", "PORT" to "eighty")

            shouldThrow<IllegalStateException> { AppConfig.fromEnv { env[it] } }
        }
    })
