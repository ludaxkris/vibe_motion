package dev.vibemotion.api.versions

import dev.vibemotion.api.catalog.AnimationTrigger
import dev.vibemotion.api.catalog.CatalogEntry
import dev.vibemotion.api.catalog.CatalogRepository
import dev.vibemotion.api.domain.Assignment
import dev.vibemotion.api.domain.Diff
import dev.vibemotion.api.domain.InvalidDiffException
import dev.vibemotion.api.domain.Trigger

/** `data-vm-id` values the clone pipeline produces: `vm-` plus a depth-first counter. */
private val VM_ID = Regex("^vm-[0-9]+$")

/**
 * The most elements one Save may touch.
 *
 * A diff is not just stored: it is replayed by every later `stateAt`, so an oversized one is a
 * permanent tax on the project rather than a one-off. Two thousand is an order of magnitude above
 * a whole-page auto-generate on a real page, and the 256 KB body cap
 * ([dev.vibemotion.api.routes.MAX_JSON_BODY_BYTES]) is the byte-level half of the same rule.
 */
internal const val MAX_DIFF_ENTRIES = 2_000

/** One element cannot need more params than any catalog entry declares, with room to spare. */
internal const val MAX_PARAMS_PER_ASSIGNMENT = 32

/** `vm-` plus a counter; 64 characters is a counter with 61 digits. */
internal const val MAX_VM_ID_LENGTH = 64

/**
 * Checks a Save against the published catalog before it reaches Postgres.
 *
 * CSS is derived from `(animationId, catalogVersion) + params`, never stored, so a diff that does
 * not resolve is not a cosmetic problem: it is a version that can never be rendered or exported.
 * Catalog files are immutable, so a diff that validates today validates forever.
 *
 * Every problem is collected rather than thrown on first sight.
 */
class DiffValidator(
    private val catalog: CatalogRepository,
) {
    /**
     * @param catalogVersion the version the editor was authoring against (`CreateVersionRequest`).
     * @throws InvalidDiffException listing everything wrong with the request.
     */
    fun validate(
        catalogVersion: String,
        diff: Diff,
    ) {
        // Before anything per-entry: an oversized diff costs one comparison to refuse, and
        // reporting two thousand problems about it would be its own denial of service.
        val entries = diff.set.size + diff.remove.size
        if (entries > MAX_DIFF_ENTRIES) {
            throw InvalidDiffException(
                listOf(
                    "diff has $entries entries (${diff.set.size} set + ${diff.remove.size} remove); " +
                        "at most $MAX_DIFF_ENTRIES are allowed in one save",
                ),
            )
        }

        val problems = mutableListOf<String>()

        if (catalog.catalog(catalogVersion) == null) {
            problems += "catalogVersion '$catalogVersion' is not a published catalog version"
        }

        diff.set.forEach { (vmId, assignment) ->
            vmIdProblem("set", vmId)?.let { problems += it }
            problems += assignmentProblems(vmId, assignment)
        }

        diff.remove.forEach { vmId ->
            vmIdProblem("remove", vmId)?.let { problems += it }
        }

        if (problems.isNotEmpty()) {
            throw InvalidDiffException(problems)
        }
    }

    /** Length first: the regex is linear, but there is no reason to run it over an essay. */
    private fun vmIdProblem(
        where: String,
        vmId: String,
    ): String? =
        when {
            vmId.length > MAX_VM_ID_LENGTH -> {
                "$where: element id is ${vmId.length} characters; at most $MAX_VM_ID_LENGTH are allowed"
            }

            !VM_ID.matches(vmId) -> {
                "$where: '$vmId' is not a valid element id (expected vm-<number>)"
            }

            else -> {
                null
            }
        }

    private fun assignmentProblems(
        vmId: String,
        assignment: Assignment,
    ): List<String> {
        val pinned =
            catalog.catalog(assignment.catalogVersion)
                ?: return listOf(
                    "set['$vmId']: catalogVersion '${assignment.catalogVersion}' is not a published catalog version",
                )
        val entry =
            pinned.entries.firstOrNull { it.id == assignment.animationId }
                ?: return listOf(
                    "set['$vmId']: animation '${assignment.animationId}' does not exist in catalog ${assignment.catalogVersion}",
                )
        return paramProblems(vmId, assignment, entry) + triggerProblems(vmId, assignment, entry)
    }

    /**
     * Keys must be declared by the pinned catalog entry, and values must match the type that entry
     * declares for them — see [paramValueProblem] for why the value half is a security boundary.
     */
    private fun paramProblems(
        vmId: String,
        assignment: Assignment,
        entry: CatalogEntry,
    ): List<String> {
        if (assignment.params.size > MAX_PARAMS_PER_ASSIGNMENT) {
            return listOf(
                "set['$vmId']: ${assignment.params.size} params; at most $MAX_PARAMS_PER_ASSIGNMENT are allowed on one element",
            )
        }
        val declared = entry.params.associateBy { it.key }
        return assignment.params.mapNotNull { (key, value) ->
            val param = declared[key] ?: return@mapNotNull "set['$vmId']: param '$key' is not declared on animation '${entry.id}'"
            paramValueProblem(param, value)?.let { "set['$vmId']: param '$key' $it" }
        }
    }

    private fun triggerProblems(
        vmId: String,
        assignment: Assignment,
        entry: CatalogEntry,
    ): List<String> =
        if (assignment.trigger.toCatalogTrigger() in entry.triggers) {
            emptyList()
        } else {
            val allowed = entry.triggers.joinToString(", ") { it.wireName }
            listOf("set['$vmId']: trigger '${assignment.trigger.wireName}' is not supported by animation '${entry.id}' (allowed: $allowed)")
        }
}

/** The two trigger enums are the same set; they differ only in which module declares them. */
internal fun Trigger.toCatalogTrigger(): AnimationTrigger =
    when (this) {
        Trigger.LOAD -> AnimationTrigger.LOAD
        Trigger.HOVER -> AnimationTrigger.HOVER
        Trigger.IN_VIEW -> AnimationTrigger.IN_VIEW
    }

internal val Trigger.wireName: String
    get() =
        when (this) {
            Trigger.LOAD -> "load"
            Trigger.HOVER -> "hover"
            Trigger.IN_VIEW -> "in-view"
        }

internal val AnimationTrigger.wireName: String
    get() =
        when (this) {
            AnimationTrigger.LOAD -> "load"
            AnimationTrigger.HOVER -> "hover"
            AnimationTrigger.IN_VIEW -> "in-view"
        }
