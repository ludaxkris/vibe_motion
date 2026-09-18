package dev.vibemotion.api

import dev.vibemotion.api.catalog.CatalogRepository
import dev.vibemotion.api.config.AppConfig
import dev.vibemotion.api.config.DatabaseSettings

internal const val TEST_WEB_ORIGIN = "http://localhost:3000"

/**
 * Services wired over the default Exposed database with a faked clone pipeline. Route specs that
 * never touch projects or versions still need a value here, and building one is free: the
 * repositories are stateless and open nothing until a transaction asks them to.
 */
internal fun testServices(
    catalog: CatalogRepository,
    cloner: FakePageCloner = FakePageCloner(),
    renderer: FakePageRenderer = FakePageRenderer(),
): AppServices = appServices(catalog, cloner, renderer)

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
