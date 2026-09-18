package dev.vibemotion.api.projects

import dev.vibemotion.api.catalog.CatalogRepository
import dev.vibemotion.api.clone.PageCloner
import dev.vibemotion.api.clone.PageRenderer
import dev.vibemotion.api.clone.RenderedPage
import dev.vibemotion.api.domain.Diff
import dev.vibemotion.api.domain.ProjectDto
import dev.vibemotion.api.domain.ResourceNotFoundException
import dev.vibemotion.api.persistence.TransactionRunner
import dev.vibemotion.api.versions.VersionRepository
import dev.vibemotion.api.versions.VersionRow
import java.time.Clock
import java.time.OffsetDateTime
import java.time.temporal.ChronoUnit
import java.util.UUID

/**
 * Projects: clone a page, serve it, throw it away.
 *
 * A project is the immutable half of the model — one cloned document, never re-fetched (a changed
 * source URL is a new project, not a new version). Everything mutable lives in `versions`.
 */
class ProjectService(
    private val projects: ProjectRepository,
    private val versions: VersionRepository,
    private val cloner: PageCloner,
    private val renderer: PageRenderer,
    private val catalog: CatalogRepository,
    private val transactions: TransactionRunner,
    private val clock: Clock = Clock.systemUTC(),
) {
    /**
     * Clones [url] and stores it with version 0.
     *
     * The fetch happens outside the transaction: it is allowed 15 seconds and several MB, and
     * holding a pooled connection open for that would starve every other request. The two inserts
     * and the pointer update then happen as one atomic step — the FK from `projects` is DEFERRABLE
     * INITIALLY DEFERRED precisely so the circular reference can be satisfied at commit.
     */
    suspend fun create(url: String): ProjectDto {
        val cloned = cloner.clone(url)
        val now = timestamp()
        val projectId = UUID.randomUUID()
        val versionId = UUID.randomUUID()
        val project =
            ProjectRow(
                id = projectId,
                // The URL the content actually came from, after redirects, so relative links in
                // base_html and the URL shown in the editor agree.
                sourceUrl = cloned.finalUrl,
                title = cloned.title,
                currentVersionId = null,
                createdAt = now,
            )

        return transactions.transactional {
            projects.insert(project, cloned.html)
            versions.insert(
                VersionRow(
                    id = versionId,
                    projectId = projectId,
                    parentVersionId = null,
                    seq = 0,
                    label = INITIAL_VERSION_LABEL,
                    catalogVersion = catalog.currentVersion,
                    diff = Diff.EMPTY,
                    createdAt = now,
                ),
            )
            projects.setCurrentVersion(projectId, versionId)
            project.copy(currentVersionId = versionId).toDto()
        }
    }

    suspend fun get(id: UUID): ProjectDto = transactions.transactional { requireProject(id) }.toDto()

    /** Cascades to every version of the project. */
    suspend fun delete(id: UUID) {
        transactions.transactional {
            if (!projects.delete(id)) throw ResourceNotFoundException("No project $id")
        }
    }

    /**
     * The document served as the editor's iframe `src`. The bridge script and the CSP are added
     * here, at serve time, so improving the bridge never means rewriting stored projects.
     */
    suspend fun page(id: UUID): RenderedPage {
        val baseHtml = transactions.transactional { projects.baseHtml(id) } ?: throw ResourceNotFoundException("No project $id")
        return renderer.render(baseHtml)
    }

    private fun requireProject(id: UUID): ProjectRow = projects.find(id) ?: throw ResourceNotFoundException("No project $id")

    /**
     * Postgres `timestamptz` keeps microseconds; the JDK clock offers nanoseconds. Truncating here
     * means the timestamp in a 201 response is the same string a later GET returns.
     */
    private fun timestamp(): OffsetDateTime = OffsetDateTime.now(clock).truncatedTo(ChronoUnit.MICROS)

    companion object {
        const val INITIAL_VERSION_LABEL = "Initial clone"
    }
}
