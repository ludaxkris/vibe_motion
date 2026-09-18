package dev.vibemotion.api.projects

import dev.vibemotion.api.domain.ProjectDto
import dev.vibemotion.api.persistence.Projects
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.vendors.ForUpdateOption
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.select
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import java.time.OffsetDateTime
import java.util.UUID

/**
 * A `projects` row without `base_html`.
 *
 * The cloned document is megabytes and is wanted by exactly one endpoint, so it is fetched on its
 * own ([ProjectRepository.baseHtml]) rather than riding along on every metadata read.
 */
data class ProjectRow(
    val id: UUID,
    val sourceUrl: String,
    val title: String,
    val currentVersionId: UUID?,
    val createdAt: OffsetDateTime,
) {
    /**
     * `currentVersionId` is nullable only because `projects` and `versions` reference each other
     * (deferrable FK). A committed project always has version 0, so a null here is a broken
     * invariant, not a client error.
     */
    fun toDto(): ProjectDto =
        ProjectDto(
            id = id.toString(),
            sourceUrl = sourceUrl,
            title = title,
            currentVersionId =
                checkNotNull(currentVersionId) {
                    "Project $id has no current version; a project is always created with version 0"
                }.toString(),
            createdAt = createdAt.toString(),
        )
}

/** Persistence for projects. Every method must be called inside a [dev.vibemotion.api.persistence.TransactionRunner] unit of work. */
interface ProjectRepository {
    fun insert(
        project: ProjectRow,
        baseHtml: String,
    )

    fun find(id: UUID): ProjectRow?

    /**
     * Reads the row with `select ... for update`.
     *
     * This is the lock that makes Save safe: two tabs saving against the same parent both queue
     * here, and the second one sees the `current_version_id` the first committed, so it gets a 409
     * instead of silently forking the history.
     */
    fun findForUpdate(id: UUID): ProjectRow?

    fun baseHtml(id: UUID): String?

    fun setCurrentVersion(
        id: UUID,
        versionId: UUID,
    )

    /** @return false when there was no such project. Versions cascade. */
    fun delete(id: UUID): Boolean
}

class ExposedProjectRepository : ProjectRepository {
    override fun insert(
        project: ProjectRow,
        baseHtml: String,
    ) {
        Projects.insert {
            it[id] = project.id
            it[sourceUrl] = project.sourceUrl
            it[title] = project.title
            it[this.baseHtml] = baseHtml
            it[currentVersionId] = project.currentVersionId
            it[createdAt] = project.createdAt
        }
    }

    override fun find(id: UUID): ProjectRow? =
        Projects
            .selectAll()
            .where { Projects.id eq id }
            .singleOrNull()
            ?.toProjectRow()

    override fun findForUpdate(id: UUID): ProjectRow? =
        Projects
            .selectAll()
            .where { Projects.id eq id }
            .forUpdate(ForUpdateOption.ForUpdate)
            .singleOrNull()
            ?.toProjectRow()

    override fun baseHtml(id: UUID): String? =
        Projects
            .select(Projects.baseHtml)
            .where { Projects.id eq id }
            .singleOrNull()
            ?.get(Projects.baseHtml)

    override fun setCurrentVersion(
        id: UUID,
        versionId: UUID,
    ) {
        Projects.update({ Projects.id eq id }) { it[currentVersionId] = versionId }
    }

    override fun delete(id: UUID): Boolean = Projects.deleteWhere { Projects.id eq id } > 0

    private fun ResultRow.toProjectRow() =
        ProjectRow(
            id = this[Projects.id],
            sourceUrl = this[Projects.sourceUrl],
            title = this[Projects.title],
            currentVersionId = this[Projects.currentVersionId],
            createdAt = this[Projects.createdAt],
        )
}
