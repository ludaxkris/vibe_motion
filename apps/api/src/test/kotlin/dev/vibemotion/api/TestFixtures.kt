package dev.vibemotion.api

import dev.vibemotion.api.config.AppConfig
import dev.vibemotion.api.config.DatabaseSettings

internal const val TEST_WEB_ORIGIN = "http://localhost:3000"

internal fun testConfig(
    database: DatabaseSettings = DatabaseSettings("jdbc:postgresql://localhost:5432/unused", "", ""),
    webOrigin: String = TEST_WEB_ORIGIN,
): AppConfig =
    AppConfig(
        port = 0,
        webOrigin = webOrigin,
        database = database,
        cloneMaxBytes = AppConfig.DEFAULT_CLONE_MAX_BYTES,
        cloneTimeoutMs = AppConfig.DEFAULT_CLONE_TIMEOUT_MS,
        appVersion = "test",
    )
