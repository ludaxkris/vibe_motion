package dev.vibemotion.api

import dev.vibemotion.api.catalog.CatalogRepository
import dev.vibemotion.api.clone.BridgePageRenderer
import dev.vibemotion.api.clone.HttpPageCloner
import dev.vibemotion.api.clone.PageCloner
import dev.vibemotion.api.clone.PageRenderer
import dev.vibemotion.api.config.AppConfig
import dev.vibemotion.api.export.ExportService
import dev.vibemotion.api.persistence.ExposedTransactionRunner
import dev.vibemotion.api.persistence.TransactionRunner
import dev.vibemotion.api.projects.ExposedProjectRepository
import dev.vibemotion.api.projects.ProjectService
import dev.vibemotion.api.versions.DiffValidator
import dev.vibemotion.api.versions.ExposedVersionRepository
import dev.vibemotion.api.versions.VersionService

/** The services the Ktor module routes to. Built once in [main], or from fakes in tests. */
data class AppServices(
    val projects: ProjectService,
    val versions: VersionService,
    val exports: ExportService,
)

/**
 * Composition root. Repositories are stateless, so this is cheap and safe to call per process.
 */
fun appServices(
    catalog: CatalogRepository,
    cloner: PageCloner,
    renderer: PageRenderer,
    transactions: TransactionRunner = ExposedTransactionRunner(),
): AppServices {
    val projectRepository = ExposedProjectRepository()
    val versionRepository = ExposedVersionRepository()
    return AppServices(
        projects = ProjectService(projectRepository, versionRepository, cloner, renderer, catalog, transactions),
        versions = VersionService(projectRepository, versionRepository, DiffValidator(catalog), catalog, transactions),
        exports = ExportService(projectRepository, versionRepository, catalog, transactions),
    )
}

/**
 * The real clone pipeline: a guarded HTTP fetch + jsoup rewrite for cloning, and the serve-time
 * renderer that adds the CSP and the bridge script tag for the configured web origin.
 */
fun defaultCloneComponents(config: AppConfig): Pair<PageCloner, PageRenderer> =
    HttpPageCloner.create(config) to BridgePageRenderer(config.webOrigin)
