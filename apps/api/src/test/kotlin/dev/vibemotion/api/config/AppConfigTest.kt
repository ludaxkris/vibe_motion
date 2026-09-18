package dev.vibemotion.api.config

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain

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

        test("keeps a literal + in a password rather than turning it into a space") {
            val settings = AppConfig.parseDatabaseUrl("postgresql://vibe_motion:pa+ss@db.internal:5432/vibe_motion")

            settings.user shouldBe "vibe_motion"
            settings.password shouldBe "pa+ss"
        }

        test("decodes an escaped percent sign into a single percent sign") {
            val settings = AppConfig.parseDatabaseUrl("postgresql://vibe_motion:pa%25ss@db.internal:5432/vibe_motion")

            settings.user shouldBe "vibe_motion"
            settings.password shouldBe "pa%ss"
        }

        test("splits user from password before decoding, so an escaped colon stays inside the user") {
            val settings = AppConfig.parseDatabaseUrl("postgresql://us%3Aer:pw@db.internal:5432/vibe_motion")

            settings.user shouldBe "us:er"
            settings.password shouldBe "pw"
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

        // WEB_ORIGIN feeds the CORS allow-list. A value Ktor cannot read as an absolute origin
        // silently allow-lists nothing, so the browser sees every request as cross-origin.
        listOf(
            "vibe-motion-web.onrender.com",
            "//vibe-motion-web.onrender.com",
            "localhost:3000",
            "ftp://vibe-motion-web.onrender.com",
            "http://",
            "/",
        ).forEach { origin ->
            test("fails fast when WEB_ORIGIN is '$origin'") {
                val env = mapOf("DATABASE_URL" to "postgresql://u:p@localhost:5432/vibe_motion", "WEB_ORIGIN" to origin)

                val failure = shouldThrow<IllegalStateException> { AppConfig.fromEnv { env[it] } }

                failure.message.orEmpty() shouldContain "WEB_ORIGIN"
            }
        }

        test("accepts an http(s) WEB_ORIGIN with a host, port optional") {
            listOf("http://localhost:3000", "https://vibe-motion-web.onrender.com", "HTTPS://Example.com/").forEach { origin ->
                val env = mapOf("DATABASE_URL" to "postgresql://u:p@localhost:5432/vibe_motion", "WEB_ORIGIN" to origin)

                AppConfig.fromEnv { env[it] }.webOrigin shouldBe origin
            }
        }
    })
