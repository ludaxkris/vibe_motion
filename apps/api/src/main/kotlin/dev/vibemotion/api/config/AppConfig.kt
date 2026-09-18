package dev.vibemotion.api.config

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

/**
 * JDBC coordinates derived from `DATABASE_URL`.
 *
 * Render hands out a libpq style URL (`postgresql://user:pass@host:port/db`); JDBC needs
 * `jdbc:postgresql://host:port/db` plus the credentials supplied separately, which also avoids
 * having to re-escape a password inside a URL.
 */
data class DatabaseSettings(
    val jdbcUrl: String,
    val user: String,
    val password: String,
)

/** Everything the service reads from the environment. Parsed once, at startup. */
data class AppConfig(
    val port: Int,
    val webOrigin: String,
    val database: DatabaseSettings,
    val cloneMaxBytes: Long,
    val cloneTimeoutMs: Long,
    val appVersion: String,
) {
    companion object {
        const val DEFAULT_PORT: Int = 8080
        const val DEFAULT_WEB_ORIGIN: String = "http://localhost:3000"
        const val DEFAULT_CLONE_MAX_BYTES: Long = 10L * 1024 * 1024
        const val DEFAULT_CLONE_TIMEOUT_MS: Long = 15_000L
        private const val DEFAULT_POSTGRES_PORT = 5432

        /**
         * Reads the configuration from [env]. Fails fast with a readable message rather than
         * starting a service that cannot serve a request.
         */
        fun fromEnv(env: (String) -> String? = { System.getenv(it) }): AppConfig {
            val databaseUrl =
                env("DATABASE_URL")?.takeIf { it.isNotBlank() }
                    ?: throw IllegalStateException("DATABASE_URL is required")
            return AppConfig(
                port = env.long("PORT", DEFAULT_PORT.toLong()).toInt(),
                webOrigin = env("WEB_ORIGIN")?.takeIf { it.isNotBlank() } ?: DEFAULT_WEB_ORIGIN,
                database = parseDatabaseUrl(databaseUrl),
                cloneMaxBytes = env.long("CLONE_MAX_BYTES", DEFAULT_CLONE_MAX_BYTES),
                cloneTimeoutMs = env.long("CLONE_TIMEOUT_MS", DEFAULT_CLONE_TIMEOUT_MS),
                appVersion =
                    env("APP_VERSION")?.takeIf { it.isNotBlank() }
                        ?: env("RENDER_GIT_COMMIT")?.takeIf { it.isNotBlank() }
                        ?: "dev",
            )
        }

        /**
         * Converts a libpq style Postgres URL into JDBC coordinates. A URL that is already a
         * `jdbc:` URL is passed through untouched so a hand-tuned local URL keeps working.
         */
        fun parseDatabaseUrl(raw: String): DatabaseSettings {
            val value = raw.trim()
            require(value.isNotEmpty()) { "DATABASE_URL must not be blank" }
            if (value.startsWith("jdbc:")) {
                return DatabaseSettings(jdbcUrl = value, user = "", password = "")
            }

            val uri =
                runCatching { URI(value) }.getOrElse {
                    throw IllegalArgumentException("DATABASE_URL is not a valid URL", it)
                }
            require(uri.scheme == "postgresql" || uri.scheme == "postgres") {
                "DATABASE_URL must use the postgresql:// scheme, got '${uri.scheme}'"
            }
            val host = uri.host ?: throw IllegalArgumentException("DATABASE_URL has no host")
            val port = if (uri.port == -1) DEFAULT_POSTGRES_PORT else uri.port
            val database = uri.path.orEmpty().removePrefix("/")
            require(database.isNotBlank()) { "DATABASE_URL has no database name" }

            val credentials = uri.userInfo.orEmpty().split(":", limit = 2)
            val jdbcUrl =
                buildString {
                    append("jdbc:postgresql://")
                    append(host)
                    append(':')
                    append(port)
                    append('/')
                    append(database)
                    uri.rawQuery?.takeIf { it.isNotBlank() }?.let {
                        append('?')
                        append(it)
                    }
                }
            return DatabaseSettings(
                jdbcUrl = jdbcUrl,
                user = decode(credentials.getOrElse(0) { "" }),
                password = decode(credentials.getOrElse(1) { "" }),
            )
        }

        private fun decode(value: String): String = URLDecoder.decode(value, StandardCharsets.UTF_8)

        private fun ((String) -> String?).long(
            key: String,
            fallback: Long,
        ): Long {
            val raw = this(key)?.takeIf { it.isNotBlank() } ?: return fallback
            return raw.trim().toLongOrNull()
                ?: throw IllegalStateException("$key must be a number, got '$raw'")
        }
    }
}
