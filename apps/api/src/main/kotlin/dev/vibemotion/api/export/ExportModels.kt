package dev.vibemotion.api.export

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.OffsetDateTime
import java.util.UUID

/*
 * The export's vocabulary: what a caller may ask for, what comes back, and the three class names
 * the stylesheet, the HTML and the script have to agree on.
 *
 * `ExportBundleDto` mirrors `ExportBundle` in `openapi.yaml`, which was frozen in Phase 0. This
 * phase changes no contract.
 */

/** `GET /projects/{projectId}/export?mode=` */
@Serializable
enum class ExportMode {
    @SerialName("full")
    FULL,

    @SerialName("snippet")
    SNIPPET,

    ;

    companion object {
        /**
         * The query parameter, or the contract's default when it is absent.
         *
         * An unrecognised value is an [IllegalArgumentException] (400 `bad_request`) rather than a
         * silent fall back to `full`: a client that asked for a snippet and got a whole page would
         * have no way to tell.
         */
        fun parse(raw: String?): ExportMode {
            if (raw == null) return FULL
            return when (raw) {
                "full" -> FULL
                "snippet" -> SNIPPET
                else -> throw IllegalArgumentException("mode must be 'full' or 'snippet'")
            }
        }
    }
}

/** One suggested file in the bundle, in the order the zip should hold them. */
@Serializable
data class ExportFile(
    val name: String,
    val contentType: String,
)

/** The response body of `GET /projects/{projectId}/export`. */
@Serializable
data class ExportBundleDto(
    val versionId: String,
    val mode: ExportMode,
    /** The rewritten page in `full` mode; null in `snippet` mode. */
    val html: String?,
    val css: String,
    /** Present only when some exported assignment uses the `in-view` trigger. */
    val js: String?,
    val files: List<ExportFile>,
)

/**
 * A parsed, self-validating export request.
 *
 * `vmId` is only meaningful in snippet mode, so that is the only mode it is checked in: a tab that
 * switches back to Full with the query parameter still attached still gets its page.
 */
data class ExportRequest(
    val projectId: UUID,
    val versionId: UUID? = null,
    val mode: ExportMode = ExportMode.FULL,
    val vmId: String? = null,
) {
    init {
        if (mode == ExportMode.SNIPPET) {
            if (vmId.isNullOrEmpty()) {
                throw ExportRequestException("missing_vm_id", "vmId is required when mode=snippet")
            }
            requireVmId(vmId)
        }
    }
}

/**
 * The part of the version being exported that reaches the output: its position in history and when
 * it was saved, both of which go in the stylesheet header. Its label never does.
 */
data class ExportVersion(
    val seq: Int,
    val createdAt: OffsetDateTime,
)

/**
 * 400 with a code of its own.
 *
 * `code` is an open string in the contract and the MSW mock already coins `missing_vm_id`, so the
 * real exporter matches it rather than flattening every request problem into `bad_request`.
 */
class ExportRequestException(
    val code: String,
    message: String,
) : RuntimeException(message)

/** The gate class the script puts on `<html>`; every `in-view` rule is scoped to it. */
const val JS_GATE_CLASS: String = "vm-js"

/** The marker class every `in-view` element carries, so one hold rule can serve all of them. */
const val IN_VIEW_MARKER_CLASS: String = "vm-in-view"

/** Added by the script when an element has been scrolled to; releases the hold rule. */
const val PLAY_CLASS: String = "vm-play"

val HTML_FILE: ExportFile = ExportFile("index.html", "text/html")
val CSS_FILE: ExportFile = ExportFile("vibe-motion.css", "text/css")
val JS_FILE: ExportFile = ExportFile("vibe-motion.js", "text/javascript")

/**
 * A clone's element id. `DiffValidator` already enforces this on everything stored, and the
 * exporter interpolates a vmId into a class name and a selector, so it is re-checked here rather
 * than trusted.
 */
private val VM_ID_RE = Regex("^vm-[0-9]+$")

/**
 * The class an element with an assignment gets: `vm-17` -> `vm-a17`.
 *
 * Derived from the id rather than allocated, so it is stable across versions: a snippet pasted
 * into a site last month still matches a full export made today, and no allocation table has to
 * be stored anywhere.
 */
fun elementClass(vmId: String): String {
    requireVmId(vmId)
    return "vm-a${vmId.removePrefix("vm-")}"
}

/**
 * [elementClass] for a key that came out of a stored diff rather than off the query string.
 *
 * `DiffValidator` has already enforced the shape, so a failure here is a data-integrity problem
 * and deserves a 500, not the 400 a malformed request gets.
 */
internal fun storedElementClass(vmId: String): String =
    runCatching { elementClass(vmId) }
        .getOrElse { throw ExportIntegrityException("A stored assignment key is not a clone element id") }

/**
 * 500: an assignment cannot be rendered.
 *
 * Save-time validation plus the immutable catalog make this unreachable. Silently skipping the
 * assignment would export a page that differs from the preview, which is worse than failing.
 * The message names the element and the param key and never the value.
 */
class ExportIntegrityException(
    message: String,
) : RuntimeException(message)

/** The value is attacker-influenced, so the message describes the shape and never echoes it. */
private fun requireVmId(vmId: String) {
    require(VM_ID_RE.matches(vmId)) { "vmId must be a clone element id of the form vm-<number>" }
}
