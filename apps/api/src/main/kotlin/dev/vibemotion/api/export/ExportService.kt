package dev.vibemotion.api.export

import dev.vibemotion.api.catalog.CatalogRepository
import dev.vibemotion.api.domain.Assignment
import dev.vibemotion.api.domain.ResourceNotFoundException
import dev.vibemotion.api.domain.State
import dev.vibemotion.api.domain.Trigger
import dev.vibemotion.api.persistence.TransactionRunner
import dev.vibemotion.api.projects.ProjectRepository
import dev.vibemotion.api.versions.VersionRepository
import dev.vibemotion.api.versions.stateAt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.util.UUID

/**
 * `GET /projects/{projectId}/export`.
 *
 * A pure function with one database read in front of it: `base_html` + the state at a saved
 * version + each assignment's pinned catalog entry -> an [ExportBundleDto]. CSS is derived, never
 * stored (CLAUDE.md rule 9), so the same version always exports the same bytes.
 *
 * ## Shape
 *
 * One read-only transaction resolves the version (absent means the project's current one), folds
 * the diffs with the same [stateAt] the versions endpoints use, and reads `base_html` **only** in
 * full mode. Everything after that is CPU work on [Dispatchers.Default], off the request thread.
 *
 * ## Memory
 *
 * A full export of a 10 MB, 75k-element document costs roughly 115-145 MB of heap against the
 * ~384 MB a starter instance has, so concurrency has to be bounded or three of them are an OOM.
 * The permit is taken **before** the transaction, not just around the emitters: the multi-megabyte
 * `base_html` string is allocated by the read, so a semaphore that only guarded the emitters would
 * bound the cheap half and leave the expensive half unbounded. It suspends rather than rejecting,
 * so there is no new status code and no new row in the contract. Snippet mode never reads
 * `base_html` at all and is not bounded.
 */
class ExportService(
    private val projects: ProjectRepository,
    private val versions: VersionRepository,
    catalog: CatalogRepository,
    private val transactions: TransactionRunner,
    private val html: PageEmitter = HtmlEmitter(),
    maxConcurrentFullExports: Int = DEFAULT_MAX_CONCURRENT_FULL_EXPORTS,
) {
    private val css = CssEmitter(catalog)
    private val fullExports = Semaphore(maxConcurrentFullExports)

    suspend fun export(request: ExportRequest): ExportBundleDto =
        when (request.mode) {
            ExportMode.SNIPPET -> {
                val input = transactions.transactional { read(request) }
                withContext(Dispatchers.Default) { asIntegrityFailure { snippet(request, input) } }
            }

            ExportMode.FULL -> {
                fullExports.withPermit {
                    val input = transactions.transactional { read(request) }
                    withContext(Dispatchers.Default) { asIntegrityFailure { full(input) } }
                }
            }
        }

    /**
     * Anything the emitters throw that is not a deliberate domain failure becomes a 500.
     *
     * `IllegalArgumentException` already maps to 400 `bad_request` (the `StatusPages` block), so a
     * jsoup `Validate`, a stray `require` or any other internal fault inside the exporter would
     * reach the client as "your request was malformed". It was not: the request was fine and we
     * could not render it. The cause is kept for the log; the message carries nothing from the
     * document or the params.
     */
    private fun <T> asIntegrityFailure(block: () -> T): T =
        try {
            block()
        } catch (expected: ResourceNotFoundException) {
            throw expected
        } catch (expected: ExportIntegrityException) {
            throw expected
        } catch (failure: RuntimeException) {
            throw ExportIntegrityException("The exporter could not render this version", failure)
        }

    /** Everything the emitters need, read in one transaction. Must be called inside one. */
    private fun read(request: ExportRequest): ExportInput {
        val project =
            projects.find(request.projectId)
                ?: throw ResourceNotFoundException("No project ${request.projectId}")
        val versionId =
            request.versionId
                ?: checkNotNull(project.currentVersionId) {
                    "Project ${project.id} has no current version; a project is always created with version 0"
                }
        // Scoped by project, so a version id from another project reads as "not found" rather than
        // leaking that it exists.
        val version =
            versions.find(request.projectId, versionId)
                ?: throw ResourceNotFoundException("No version $versionId in project ${request.projectId}")

        return ExportInput(
            versionId = versionId,
            version = ExportVersion(seq = version.seq, createdAt = version.createdAt),
            state = stateAt(versions.diffsUpTo(request.projectId, version.seq).map { it.diff }),
            // Megabytes, and only full mode has anything to do with them.
            baseHtml =
                if (request.mode == ExportMode.FULL) {
                    projects.baseHtml(request.projectId)
                        ?: throw ResourceNotFoundException("No project ${request.projectId}")
                } else {
                    null
                },
        )
    }

    private fun full(input: ExportInput): ExportBundleDto {
        val needsScript = input.state.values.any { it.trigger == Trigger.IN_VIEW }
        val classes =
            input.state.mapValues { (vmId, assignment) ->
                listOfNotNull(
                    storedElementClass(vmId),
                    IN_VIEW_MARKER_CLASS.takeIf { assignment.trigger == Trigger.IN_VIEW },
                )
            }

        return ExportBundleDto(
            versionId = input.versionId.toString(),
            mode = ExportMode.FULL,
            html = html.emit(checkNotNull(input.baseHtml) { "Full mode reads base_html" }, classes, needsScript),
            css = css.stylesheet(input.version, input.state),
            js = if (needsScript) InViewScript.source() else null,
            files = listOfNotNull(HTML_FILE, CSS_FILE, JS_FILE.takeIf { needsScript }),
        )
    }

    private fun snippet(
        request: ExportRequest,
        input: ExportInput,
    ): ExportBundleDto {
        val vmId = checkNotNull(request.vmId) { "ExportRequest refuses snippet mode without a vmId" }
        // A snippet of an element with no animation has nothing to say, and silently returning an
        // empty stylesheet would read as "this element has none" rather than "you asked for the
        // wrong element".
        val assignment: Assignment =
            input.state[vmId]
                ?: throw ResourceNotFoundException("No assignment for $vmId in version ${input.versionId}")
        val needsScript = assignment.trigger == Trigger.IN_VIEW

        return ExportBundleDto(
            versionId = input.versionId.toString(),
            mode = ExportMode.SNIPPET,
            html = null,
            css = css.snippet(input.version, vmId, assignment),
            js = if (needsScript) InViewScript.source() else null,
            files = listOfNotNull(CSS_FILE, JS_FILE.takeIf { needsScript }),
        )
    }

    companion object {
        /**
         * Two at a time. Measured at 115-145 MB peak per full export of a 10 MB document, against
         * the ~384 MB heap of a starter instance.
         */
        const val DEFAULT_MAX_CONCURRENT_FULL_EXPORTS: Int = 2
    }
}

/** The database's whole contribution to an export, read once. */
private data class ExportInput(
    val versionId: UUID,
    val version: ExportVersion,
    val state: State,
    /** Null in snippet mode, which never needs the document. */
    val baseHtml: String?,
)
