package dev.vibemotion.api.versions

import dev.vibemotion.api.catalog.CatalogRepository
import dev.vibemotion.api.domain.Assignment
import dev.vibemotion.api.domain.CreateVersionRequest
import dev.vibemotion.api.domain.Diff
import dev.vibemotion.api.domain.EmptyDiffException
import dev.vibemotion.api.domain.ResourceNotFoundException
import dev.vibemotion.api.domain.StaleParentException
import dev.vibemotion.api.domain.State
import dev.vibemotion.api.domain.VersionDto
import dev.vibemotion.api.domain.VersionListResponse
import dev.vibemotion.api.domain.VersionStateResponse
import dev.vibemotion.api.persistence.TransactionRunner
import dev.vibemotion.api.projects.ProjectRepository
import dev.vibemotion.api.projects.ProjectRow
import java.time.Clock
import java.time.OffsetDateTime
import java.time.temporal.ChronoUnit
import java.util.UUID

/** `label` cap from `openapi.yaml`. */
private const val MAX_LABEL_LENGTH = 200

/**
 * Version history: append-only, linear, and only ever written when the user clicks Save.
 *
 * Each version stores the diff from its parent; full state is folded on demand by [stateAt].
 * Restoring appends a new version rather than moving a pointer backwards, so nothing in history is
 * ever rewritten or lost.
 */
class VersionService(
    private val projects: ProjectRepository,
    private val versions: VersionRepository,
    private val validator: DiffValidator,
    private val catalog: CatalogRepository,
    private val transactions: TransactionRunner,
    private val clock: Clock = Clock.systemUTC(),
) {
    suspend fun list(projectId: UUID): VersionListResponse =
        transactions.transactional {
            val project = requireProject(projectId)
            VersionListResponse(
                currentVersionId = requireCurrentVersionId(project).toString(),
                versions = versions.listByProject(projectId).map { it.toDto() },
            )
        }

    /**
     * Save.
     *
     * The whole check-and-append runs under `select ... for update` on the project row, so the
     * comparison of `parentVersionId` against the project's current version and the write that
     * advances it cannot be interleaved with another tab's save. The loser gets a 409 carrying the
     * version it lost to, never a silently forked history.
     */
    suspend fun create(
        projectId: UUID,
        request: CreateVersionRequest,
    ): VersionDto {
        val parentVersionId = request.parentVersionId.asUuid("parentVersionId")
        if (request.diff.isEmpty) {
            throw EmptyDiffException("Diff is empty: a save that changes nothing does not create a version")
        }
        validator.validate(request.catalogVersion, request.diff)
        val label = requestedLabel(request.label) ?: describeDiff(request.diff, ::animationName)

        return transactions.transactional {
            val project = lockProject(projectId)
            val currentVersionId = requireCurrentVersionId(project)
            val current = requireVersion(projectId, currentVersionId)
            if (parentVersionId != currentVersionId) {
                throw StaleParentException(
                    currentVersion = current.toDto(),
                    message = "parentVersionId $parentVersionId is not the current version ($currentVersionId)",
                )
            }
            append(
                project = project,
                parent = current,
                label = label,
                catalogVersion = request.catalogVersion,
                diff = request.diff,
            )
        }
    }

    /** The materialised state at [versionId]: the fold of every diff from v0 through it. */
    suspend fun stateAt(
        projectId: UUID,
        versionId: UUID,
    ): VersionStateResponse =
        transactions.transactional {
            val target = requireVersion(projectId, versionId)
            VersionStateResponse(versionId = versionId.toString(), state = materialise(projectId, target.seq))
        }

    /**
     * Appends a version whose diff returns the project to [versionId]'s state.
     *
     * History is never rewritten, so a restore is an ordinary save with a server-computed diff. An
     * explicit restore to the state the project is already in is still recorded: the user asked for
     * it, and an empty diff in the history is a truthful "nothing changed here".
     */
    suspend fun restore(
        projectId: UUID,
        versionId: UUID,
        label: String? = null,
    ): VersionDto {
        val requested = requestedLabel(label)

        return transactions.transactional {
            val project = lockProject(projectId)
            val target = requireVersion(projectId, versionId)
            val current = requireVersion(projectId, requireCurrentVersionId(project))
            append(
                project = project,
                parent = current,
                label = requested ?: "Restored v${target.seq}",
                // Informational: the catalog the state being restored was authored against. The
                // pin that decides the CSS is the one inside each assignment.
                catalogVersion = target.catalogVersion,
                diff = diffBetween(materialise(projectId, current.seq), materialise(projectId, target.seq)),
            )
        }
    }

    private fun append(
        project: ProjectRow,
        parent: VersionRow,
        label: String,
        catalogVersion: String,
        diff: Diff,
    ): VersionDto {
        val version =
            VersionRow(
                id = UUID.randomUUID(),
                projectId = project.id,
                parentVersionId = parent.id,
                seq = parent.seq + 1,
                label = label,
                catalogVersion = catalogVersion,
                diff = diff,
                createdAt = OffsetDateTime.now(clock).truncatedTo(ChronoUnit.MICROS),
            )
        versions.insert(version)
        projects.setCurrentVersion(project.id, version.id)
        return version.toDto()
    }

    private fun materialise(
        projectId: UUID,
        throughSeq: Int,
    ): State = stateAt(versions.diffsUpTo(projectId, throughSeq))

    private fun animationName(assignment: Assignment): String? =
        catalog
            .catalog(assignment.catalogVersion)
            ?.entries
            ?.firstOrNull { it.id == assignment.animationId }
            ?.name

    private fun requireProject(projectId: UUID): ProjectRow =
        projects.find(projectId) ?: throw ResourceNotFoundException("No project $projectId")

    private fun lockProject(projectId: UUID): ProjectRow =
        projects.findForUpdate(projectId) ?: throw ResourceNotFoundException("No project $projectId")

    private fun requireVersion(
        projectId: UUID,
        versionId: UUID,
    ): VersionRow = versions.find(projectId, versionId) ?: throw ResourceNotFoundException("No version $versionId in project $projectId")

    /** A blank label means "generate one"; an over-long one is a 400, as `openapi.yaml` caps it. */
    private fun requestedLabel(raw: String?): String? {
        val label = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        require(label.length <= MAX_LABEL_LENGTH) { "label must be at most $MAX_LABEL_LENGTH characters" }
        return label
    }

    private fun requireCurrentVersionId(project: ProjectRow): UUID =
        checkNotNull(project.currentVersionId) {
            "Project ${project.id} has no current version; a project is always created with version 0"
        }
}

/** A malformed uuid in a request body is a 400, the same as one in the path. */
private fun String.asUuid(field: String): UUID =
    runCatching { UUID.fromString(this) }.getOrElse {
        throw IllegalArgumentException("$field must be a uuid, got '$this'", it)
    }
