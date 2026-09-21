package dev.vibemotion.api.export

import dev.vibemotion.api.domain.Diff
import dev.vibemotion.api.persistence.TransactionRunner
import dev.vibemotion.api.projects.ProjectRepository
import dev.vibemotion.api.projects.ProjectRow
import dev.vibemotion.api.versions.SeqDiff
import dev.vibemotion.api.versions.VersionRepository
import dev.vibemotion.api.versions.VersionRow
import java.time.OffsetDateTime
import java.util.UUID

/**
 * In-memory repositories for the export route specs.
 *
 * The exporter is a pure function of `base_html`, the folded state and the catalog, so every row
 * of the error table can be driven without a database. `ExportApiTest` runs the happy path against
 * a real Postgres so the wiring and the SQL are proved too.
 */
internal class FakeExportRepositories(
    val projectId: UUID = UUID.randomUUID(),
) : ProjectRepository,
    VersionRepository,
    TransactionRunner {
    var baseHtml: String? = DEFAULT_BASE_HTML
    var currentVersionId: UUID? = null

    /** Reads are counted so a spec can prove snippet mode never touches the document column. */
    var baseHtmlReads: Int = 0
        private set

    private val rows = LinkedHashMap<UUID, VersionRow>()

    override suspend fun <T> transactional(block: () -> T): T = block()

    fun addVersion(
        seq: Int,
        diff: Diff,
        createdAt: OffsetDateTime = OffsetDateTime.parse("2026-09-20T21:30:00Z"),
        projectId: UUID = this.projectId,
    ): VersionRow {
        val row =
            VersionRow(
                id = UUID.randomUUID(),
                projectId = projectId,
                parentVersionId = rows.values.lastOrNull()?.id,
                seq = seq,
                label = "v$seq",
                catalogVersion = "1.1.0",
                diff = diff,
                createdAt = createdAt,
            )
        rows[row.id] = row
        if (projectId == this.projectId) currentVersionId = row.id
        return row
    }

    // --- ProjectRepository ---------------------------------------------------

    override fun find(id: UUID): ProjectRow? =
        if (id == projectId) {
            ProjectRow(
                id = projectId,
                sourceUrl = "https://example.com/",
                title = "Example",
                currentVersionId = currentVersionId,
                createdAt = OffsetDateTime.parse("2026-09-01T00:00:00Z"),
            )
        } else {
            null
        }

    override fun baseHtml(id: UUID): String? {
        baseHtmlReads++
        return if (id == projectId) baseHtml else null
    }

    override fun exists(id: UUID): Boolean = id == projectId

    override fun insert(
        project: ProjectRow,
        baseHtml: String,
    ): Unit = unsupported()

    override fun findForUpdate(id: UUID): ProjectRow? = unsupported()

    override fun setCurrentVersion(
        id: UUID,
        versionId: UUID,
    ): Unit = unsupported()

    override fun delete(id: UUID): Boolean = unsupported()

    // --- VersionRepository ---------------------------------------------------

    override fun find(
        projectId: UUID,
        versionId: UUID,
    ): VersionRow? = rows[versionId]?.takeIf { it.projectId == projectId }

    override fun diffsUpTo(
        projectId: UUID,
        throughSeq: Int,
    ): List<SeqDiff> =
        rows.values
            .filter { it.projectId == projectId && it.seq <= throughSeq }
            .sortedBy { it.seq }
            .map { SeqDiff(it.seq, it.diff) }

    override fun listByProject(projectId: UUID): List<VersionRow> = rows.values.filter { it.projectId == projectId }

    override fun insert(version: VersionRow): Unit = unsupported()

    private fun unsupported(): Nothing = throw UnsupportedOperationException("Not needed by the export specs")

    companion object {
        /** Shaped like a clone: ids from 1, real classes, nothing executable. */
        const val DEFAULT_BASE_HTML: String =
            "<!doctype html>\n<html lang=\"en\">\n<head><meta charset=\"utf-8\">\n<title>Example</title>\n</head>\n" +
                "<body>\n<h1 data-vm-id=\"vm-1\">Hi</h1>\n<p class=\"lede\" data-vm-id=\"vm-2\">There</p>\n" +
                "<a class=\"cta\" href=\"https://example.com/go\" data-vm-id=\"vm-3\">Go</a>\n</body>\n</html>\n"
    }
}
