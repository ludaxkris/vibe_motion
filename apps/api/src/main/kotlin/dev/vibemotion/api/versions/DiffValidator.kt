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
        val problems = mutableListOf<String>()

        if (catalog.catalog(catalogVersion) == null) {
            problems += "catalogVersion '$catalogVersion' is not a published catalog version"
        }

        diff.set.forEach { (vmId, assignment) ->
            if (!VM_ID.matches(vmId)) {
                problems += "set: '$vmId' is not a valid element id (expected vm-<number>)"
            }
            problems += assignmentProblems(vmId, assignment)
        }

        diff.remove.forEach { vmId ->
            if (!VM_ID.matches(vmId)) {
                problems += "remove: '$vmId' is not a valid element id (expected vm-<number>)"
            }
        }

        if (problems.isNotEmpty()) {
            throw InvalidDiffException(problems)
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

    private fun paramProblems(
        vmId: String,
        assignment: Assignment,
        entry: CatalogEntry,
    ): List<String> {
        val declared = entry.params.mapTo(mutableSetOf()) { it.key }
        return assignment.params.keys
            .filterNot { it in declared }
            .map { "set['$vmId']: param '$it' is not declared on animation '${entry.id}'" }
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
