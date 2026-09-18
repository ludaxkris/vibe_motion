package dev.vibemotion.api.catalog

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Kotlin mirror of `packages/animation-catalog/schema.json`. The JSON Schema stays authoritative;
 * these classes exist so the API fails loudly at startup if a published catalog file ever drifts
 * away from it. Unknown keys are *not* tolerated, for the same reason.
 */
@Serializable
data class Catalog(
    val version: String,
    val entries: List<CatalogEntry>,
)

@Serializable
data class CatalogEntry(
    val id: String,
    val name: String,
    val category: AnimationCategory,
    val description: String,
    val keyframes: String,
    val params: List<CatalogParam>,
    val triggers: List<AnimationTrigger>,
    val defaultTrigger: AnimationTrigger? = null,
    val baseStyles: String? = null,
)

@Serializable
data class CatalogParam(
    val key: String,
    val label: String? = null,
    val type: ParamType,
    val default: String,
    val min: String? = null,
    val max: String? = null,
    val step: String? = null,
    val options: List<String>? = null,
    val cssVar: String? = null,
) {
    /** True for the five keys that map straight onto `animation-*` properties. */
    val isStandard: Boolean get() = key in STANDARD_KEYS

    companion object {
        val STANDARD_KEYS: Set<String> = setOf("duration", "delay", "easing", "iteration", "direction")
    }
}

@Serializable
enum class AnimationCategory {
    @SerialName("entrance")
    ENTRANCE,

    @SerialName("exit")
    EXIT,

    @SerialName("attention")
    ATTENTION,

    @SerialName("emphasis")
    EMPHASIS,

    @SerialName("continuous")
    CONTINUOUS,

    @SerialName("hover")
    HOVER,
}

@Serializable
enum class AnimationTrigger {
    @SerialName("load")
    LOAD,

    @SerialName("hover")
    HOVER,

    @SerialName("in-view")
    IN_VIEW,
}

@Serializable
enum class ParamType {
    @SerialName("duration")
    DURATION,

    @SerialName("easing")
    EASING,

    @SerialName("iteration")
    ITERATION,

    @SerialName("direction")
    DIRECTION,

    @SerialName("length")
    LENGTH,

    @SerialName("number")
    NUMBER,

    @SerialName("angle")
    ANGLE,

    @SerialName("percentage")
    PERCENTAGE,

    @SerialName("color")
    COLOR,

    @SerialName("select")
    SELECT,
}
