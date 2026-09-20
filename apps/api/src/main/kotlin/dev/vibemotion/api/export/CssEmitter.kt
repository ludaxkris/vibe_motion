package dev.vibemotion.api.export

import dev.vibemotion.api.catalog.CatalogEntry
import dev.vibemotion.api.catalog.CatalogRepository
import dev.vibemotion.api.catalog.keyframesName
import dev.vibemotion.api.domain.Assignment
import dev.vibemotion.api.domain.State
import dev.vibemotion.api.domain.Trigger
import dev.vibemotion.api.versions.paramValueProblem
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * The stylesheet: `@keyframes` blocks, then one rule group per assignment inside a
 * `prefers-reduced-motion` media query.
 *
 * Pure, deterministic and derived: the same version and state always produce the same bytes, and
 * nothing is read except the immutable catalog entry each assignment pins. Every rule is the same
 * cascade the preview applies (bridge spec §6a), with the divergences that spec lists.
 *
 * Three things this is careful about:
 *
 * - the **`animation` shorthand**, always and whole, so a host page's longhands cannot leak into
 *   our animation (spec §6a). A standard key the pinned entry does not declare is written at its
 *   CSS initial value, so catalog 1.0.0 — which predates `fillMode` — still resets fill-mode;
 * - **`entry.id`**, never the stored `animationId`, is what names a keyframes rule (DT-069);
 * - **every resolved param value is re-validated** with the same function that guarded it at save
 *   time. A value that no longer passes fails the export rather than becoming live CSS on someone
 *   else's site.
 */
class CssEmitter(
    private val catalog: CatalogRepository,
) {
    /** Every assignment in [state], in state order. */
    fun stylesheet(
        version: ExportVersion,
        state: State,
    ): String {
        val resolved = state.map { (vmId, assignment) -> resolve(vmId, assignment) }
        return render(version, resolved, classComment = null)
    }

    /**
     * One assignment, with the line that says which class to put on the element.
     *
     * The same generator scoped to one element, so a snippet and a full export of the same version
     * cannot disagree.
     */
    fun snippet(
        version: ExportVersion,
        vmId: String,
        assignment: Assignment,
    ): String {
        val resolved = resolve(vmId, assignment)
        val classes = listOfNotNull(resolved.className, IN_VIEW_MARKER_CLASS.takeIf { resolved.trigger == Trigger.IN_VIEW })
        return render(version, listOf(resolved), classComment = """/* add class="${classes.joinToString(" ")}" to the element */""")
    }

    private fun render(
        version: ExportVersion,
        resolved: List<ResolvedAssignment>,
        classComment: String?,
    ): String {
        val sections = mutableListOf(header(version, resolved))
        classComment?.let { sections += it }

        val keyframes = LinkedHashMap<String, String>()
        resolved.forEach { keyframes.putIfAbsent(it.keyframesName, "@keyframes ${it.keyframesName} { ${it.entry.keyframes} }") }
        if (keyframes.isNotEmpty()) sections += keyframes.values.joinToString("\n")

        val groups = resolved.map { it.ruleGroup() } + listOfNotNull(holdGroup(resolved))
        if (groups.isNotEmpty()) {
            sections += "@media ($REDUCED_MOTION) {\n${groups.joinToString("\n\n")}\n}"
        }

        return sections.joinToString("\n\n") + "\n"
    }

    /**
     * Format number, the version's seq, the date it was saved in UTC, and the catalog versions the
     * rules below resolved against. Nothing else: no label, no title and no URL ever reaches any
     * output.
     */
    private fun header(
        version: ExportVersion,
        resolved: List<ResolvedAssignment>,
    ): String {
        val saved = DATE.format(version.createdAt.withOffsetSameInstant(ZoneOffset.UTC))
        val pins = resolved.map { it.catalogVersion }.distinct().sortedWith(::compareSemver)
        val catalogs = if (pins.isEmpty()) "" else " · catalog ${pins.joinToString(", ")}"
        return "/* Vibe Motion · format $FORMAT_VERSION · v${version.seq} · saved $saved (UTC)$catalogs */"
    }

    /**
     * One hold rule serves every `in-view` element through the marker class: a new animation,
     * paused at its first keyframe, until the script says otherwise (bridge spec §6a, D3).
     * `:where()` keeps the gate free, so this is (0,2,0) against the assignment rule's (0,1,0).
     */
    private fun holdGroup(resolved: List<ResolvedAssignment>): String? {
        if (resolved.none { it.trigger == Trigger.IN_VIEW }) return null
        return group(
            "in-view: held on its first keyframe until the script says it is on screen",
            rule(
                ":where(.$JS_GATE_CLASS) .$IN_VIEW_MARKER_CLASS:not(.$PLAY_CLASS)",
                listOf("animation-play-state: paused;", "animation-delay: 0s;", "animation-fill-mode: both;"),
            ),
        )
    }

    private fun ResolvedAssignment.ruleGroup(): String {
        val resting = baseStyleLines() + customPropertyLines()
        val animation = "animation: $shorthand;"

        return when (trigger) {
            Trigger.LOAD -> {
                group("load", rule(".$className", resting + animation))
            }

            // CSS `:hover` matches while any descendant is hovered, which is exactly the bridge's
            // "arm the whole chain of tagged ancestors" (spec D3b). Custom properties and base
            // styles stay unconditional: they are inert on their own, and the animation reads them.
            Trigger.HOVER -> {
                group(
                    if (resting.isEmpty()) {
                        "hover"
                    } else {
                        "hover: base styles and custom properties always, the animation only while hovered"
                    },
                    listOfNotNull(
                        rule(".$className", resting).takeIf { resting.isNotEmpty() },
                        rule(".$className:hover", listOf(animation)),
                    ).joinToString("\n\n"),
                )
            }

            // Gated on the class the script puts on <html>: without JavaScript the element simply
            // rests in its normal state rather than being left on a first keyframe of `opacity: 0`.
            Trigger.IN_VIEW -> {
                group("in-view", rule(":where(.$JS_GATE_CLASS) .$className", resting + animation))
            }
        }
    }

    /** The entry's declarations exactly as the catalog wrote them, trimmed and `;`-terminated. */
    private fun ResolvedAssignment.baseStyleLines(): List<String> {
        val declarations = entry.baseStyles?.trim().orEmpty()
        if (declarations.isEmpty()) return emptyList()
        return listOf(if (declarations.endsWith(";")) declarations else "$declarations;")
    }

    private fun ResolvedAssignment.customPropertyLines(): List<String> =
        entry.params.mapNotNull { param ->
            param.cssVar?.let { cssVar -> "$cssVar: ${params.getValue(param.key)};" }
        }

    private fun group(
        comment: String,
        body: String,
    ): String = "$INDENT/* $comment */\n$body"

    private fun rule(
        selector: String,
        declarations: List<String>,
    ): String = "$INDENT$selector {\n" + declarations.joinToString("\n") { "$INDENT$INDENT$it" } + "\n$INDENT}"

    private fun resolve(
        vmId: String,
        assignment: Assignment,
    ): ResolvedAssignment {
        val className = storedElementClass(vmId)
        val entries =
            catalog.catalog(assignment.catalogVersion)?.entries
                ?: throw ExportIntegrityException(
                    "Assignment on $vmId pins catalog version ${assignment.catalogVersion}, which this build does not have",
                )
        // The resolved entry's own id is what names the rule, whatever the stored string says.
        val entry =
            entries.firstOrNull { it.id == assignment.animationId }
                ?: entries.firstOrNull { it.id.equals(assignment.animationId, ignoreCase = true) }
                ?: throw ExportIntegrityException(
                    "Assignment on $vmId names an animation that catalog ${assignment.catalogVersion} does not have",
                )

        val params =
            entry.params.associate { param ->
                val value = assignment.params[param.key] ?: param.default
                if (paramValueProblem(param, value) != null) {
                    // The value itself is never repeated: it is attacker-influenced and this ends
                    // up in a server log.
                    throw ExportIntegrityException(
                        "Assignment on $vmId has a '${param.key}' value that no longer validates against catalog ${assignment.catalogVersion}",
                    )
                }
                param.key to value
            }

        return ResolvedAssignment(
            vmId = vmId,
            className = className,
            trigger = assignment.trigger,
            entry = entry,
            catalogVersion = assignment.catalogVersion,
            keyframesName = keyframesName(entry.id, assignment.catalogVersion),
            params = params,
        )
    }

    private companion object {
        /** Bumped only if the shape of the emitted files changes in a way a reader would notice. */
        const val FORMAT_VERSION = 1
        const val INDENT = "  "
        const val REDUCED_MOTION = "prefers-reduced-motion: no-preference"

        val DATE: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")

        fun compareSemver(
            left: String,
            right: String,
        ): Int {
            val a = left.split(".").map { it.toIntOrNull() ?: 0 }
            val b = right.split(".").map { it.toIntOrNull() ?: 0 }
            (0 until maxOf(a.size, b.size)).forEach { index ->
                val difference = (a.getOrNull(index) ?: 0).compareTo(b.getOrNull(index) ?: 0)
                if (difference != 0) return difference
            }
            return 0
        }
    }
}

/** An assignment with its catalog entry resolved and every param value re-validated. */
private data class ResolvedAssignment(
    val vmId: String,
    val className: String,
    val trigger: Trigger,
    val entry: CatalogEntry,
    val catalogVersion: String,
    val keyframesName: String,
    /** Every key the entry declares, at the assignment's value or the catalog default. */
    val params: Map<String, String>,
) {
    /**
     * `name duration timing-function delay iteration-count direction fill-mode`, always in that
     * order and always whole.
     *
     * Unambiguous for every catalog value: durations and delays carry a unit, easing is a keyword
     * or a function, iteration is `infinite` or a number, direction is a keyword, and a keyframes
     * name is `vm-…` and never a keyword.
     */
    val shorthand: String
        get() =
            (listOf(keyframesName) + SHORTHAND_SLOTS.map { (key, initial) -> params[key] ?: initial })
                .joinToString(" ")

    private companion object {
        /** Catalog param key -> the CSS initial value of the longhand it fills, in shorthand order. */
        val SHORTHAND_SLOTS =
            listOf(
                "duration" to "0s",
                "easing" to "ease",
                "delay" to "0s",
                "iteration" to "1",
                "direction" to "normal",
                "fillMode" to "none",
            )
    }
}
