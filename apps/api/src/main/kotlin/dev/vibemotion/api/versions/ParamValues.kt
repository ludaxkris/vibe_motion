package dev.vibemotion.api.versions

import dev.vibemotion.api.catalog.CatalogParam
import dev.vibemotion.api.catalog.ParamType

/*
 * Param VALUES, checked against the type the pinned catalog entry declares for them.
 *
 * This is a security boundary, not a nicety. A param value is interpolated into CSS — a custom
 * property today, exported stylesheet text in Phase 7 — and an export runs on the designer's own
 * site. A value that escapes its declaration ("600ms; } body { background: url(//evil) ") would
 * therefore be stored once and emitted as live CSS later, on a different origin, long after anyone
 * is looking. So the rule is allow-list only: every value must match the shape its declared
 * [ParamType] admits, and nothing that could terminate a declaration, open a block, start a
 * comment, fetch a URL or open a tag survives regardless of type.
 *
 * Catalog files are immutable, so a value that validates today validates forever, and the
 * validator is verified against every default in every bundled catalog version (see
 * ParamValuesTest) — a catalog release this cannot accept fails the API gate rather than the user.
 */

/** Long enough for `cubic-bezier(...)` and `rgba(...)`, far too short for a payload. */
internal const val MAX_PARAM_VALUE_LENGTH = 200

/** How much of a rejected value is echoed back, so an error message cannot become a mirror. */
private const val MAX_ECHOED_VALUE_LENGTH = 40

private val NUMBER = """-?\d+(\.\d+)?"""
private val UNSIGNED_NUMBER = """\d+(\.\d+)?"""

private val DURATION = Regex("""^$UNSIGNED_NUMBER(ms|s)$""")
private val LENGTH = Regex("""^$NUMBER(px|rem|em|%|vh|vw)$""")
private val NUMERIC = Regex("""^$NUMBER$""")
private val ANGLE = Regex("""^$NUMBER(deg|rad|turn)$""")
private val PERCENTAGE = Regex("""^$NUMBER%$""")
private val ITERATION = Regex("""^$UNSIGNED_NUMBER$""")
private val CUBIC_BEZIER = Regex("""^cubic-bezier\(\s*$NUMBER\s*,\s*$NUMBER\s*,\s*$NUMBER\s*,\s*$NUMBER\s*\)$""")
private val STEPS = Regex("""^steps\(\s*\d{1,4}\s*(,\s*(jump-start|jump-end|jump-none|jump-both|start|end)\s*)?\)$""")
private val HEX_COLOUR = Regex("""^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$""")
private val FUNCTIONAL_COLOUR = Regex("""^(rgb|rgba|hsl|hsla)\(\s*$NUMBER%?(\s*,\s*$NUMBER%?){2,3}\s*\)$""")
private val COLOUR_KEYWORD = Regex("""^[a-zA-Z]{1,24}$""")

private val NAMED_EASINGS = setOf("linear", "ease", "ease-in", "ease-out", "ease-in-out", "step-start", "step-end")
private val DIRECTIONS = setOf("normal", "reverse", "alternate", "alternate-reverse")

/** Nothing that can end a declaration, open a block or a tag, start a comment, or quote. */
private val FORBIDDEN_CHARACTERS = setOf(';', '{', '}', '<', '>', '\\', '"', '\'')

/** Case-insensitive substrings that fetch or execute, whatever the surrounding syntax. */
private val FORBIDDEN_SUBSTRINGS = listOf("/*", "*/", "url(", "expression(", "javascript:", "@import")

/** A magnitude with the unit it was written in; `null` unit for a bare number. */
private data class Measure(
    val magnitude: Double,
    val unit: String?,
)

/**
 * @return null when [value] is an acceptable value for [param], otherwise the reason, phrased for
 *   the designer and safe to put in a 422 body.
 */
internal fun paramValueProblem(
    param: CatalogParam,
    value: String,
): String? {
    if (value.isEmpty()) return "value must not be empty"
    if (value.length > MAX_PARAM_VALUE_LENGTH) {
        return "value is ${value.length} characters; at most $MAX_PARAM_VALUE_LENGTH are allowed"
    }
    unsafeCharacterProblem(value)?.let { return it }
    typeProblem(param, value)?.let { return it }
    return boundsProblem(param, value)
}

/**
 * Applied to every value before its type is considered, so a type this build does not yet handle
 * strictly can never become the hole.
 */
private fun unsafeCharacterProblem(value: String): String? {
    value.forEach { character ->
        if (character.isISOControl()) return "value contains a control character"
        if (character in FORBIDDEN_CHARACTERS) return "value contains '$character', which is not allowed in a CSS value"
    }
    val lowered = value.lowercase()
    FORBIDDEN_SUBSTRINGS.forEach { forbidden ->
        if (lowered.contains(forbidden)) return "value contains '$forbidden', which is not allowed in a CSS value"
    }
    return null
}

private fun typeProblem(
    param: CatalogParam,
    value: String,
): String? {
    val ok =
        when (param.type) {
            ParamType.DURATION -> DURATION.matches(value)
            ParamType.LENGTH -> LENGTH.matches(value)
            ParamType.NUMBER -> NUMERIC.matches(value)
            ParamType.ANGLE -> ANGLE.matches(value)
            ParamType.PERCENTAGE -> PERCENTAGE.matches(value)
            ParamType.ITERATION -> value == "infinite" || ITERATION.matches(value)
            ParamType.DIRECTION -> value in DIRECTIONS
            ParamType.EASING -> value in NAMED_EASINGS || CUBIC_BEZIER.matches(value) || STEPS.matches(value)
            ParamType.COLOR -> isColour(value)
            ParamType.SELECT -> value in param.options.orEmpty()
        }
    if (ok) return null
    if (param.type == ParamType.SELECT) {
        val declared = param.options.orEmpty().joinToString(", ")
        return "value is not one of the options the catalog declares (${declared.take(MAX_ECHOED_VALUE_LENGTH)})"
    }
    return "value ${echo(value)} is not a valid ${param.type.name.lowercase()}"
}

private fun isColour(value: String): Boolean =
    HEX_COLOUR.matches(value) || FUNCTIONAL_COLOUR.matches(value) || COLOUR_KEYWORD.matches(value)

/**
 * `min`/`max` from the catalog entry, compared in the unit the catalog wrote them in.
 *
 * The editor always sends the catalog's own unit, so a mismatch is not something to convert away:
 * it means the request did not come from the editor, and `40vh` silently compared against a
 * `200px` maximum is exactly the kind of quiet nonsense that ends up in an export. Durations are
 * the one exception, because `s` and `ms` are the same quantity and both are natural to write.
 */
private fun boundsProblem(
    param: CatalogParam,
    value: String,
): String? {
    if (param.type !in BOUNDED_TYPES) return null
    val declaredMin = param.min
    val declaredMax = param.max
    if (declaredMin == null && declaredMax == null) return null
    val actual = measure(param.type, value) ?: return null

    if (declaredMin != null) {
        // An unparseable bound is a catalog bug, not a client one: ignore it rather than refusing
        // every value for that param.
        val min = measure(param.type, declaredMin)
        if (min != null) {
            if (actual.unit != min.unit) return "value is in a different unit than the catalog's minimum of ${echo(declaredMin)}"
            if (actual.magnitude < min.magnitude) return "value ${echo(value)} is below the catalog's minimum of ${echo(declaredMin)}"
        }
    }
    if (declaredMax != null) {
        val max = measure(param.type, declaredMax)
        if (max != null) {
            if (actual.unit != max.unit) return "value is in a different unit than the catalog's maximum of ${echo(declaredMax)}"
            if (actual.magnitude > max.magnitude) return "value ${echo(value)} is above the catalog's maximum of ${echo(declaredMax)}"
        }
    }
    return null
}

private val BOUNDED_TYPES = setOf(ParamType.DURATION, ParamType.LENGTH, ParamType.NUMBER, ParamType.ANGLE, ParamType.PERCENTAGE)

/** Splits an already type-checked value into magnitude and unit; null when it does not parse. */
private fun measure(
    type: ParamType,
    value: String,
): Measure? {
    val unit = value.takeLastWhile { !it.isDigit() && it != '.' }
    val magnitude = value.dropLast(unit.length).toDoubleOrNull() ?: return null
    // Milliseconds are the canonical duration unit, so `2s` and `2000ms` compare as one quantity.
    if (type == ParamType.DURATION && unit == "s") return Measure(magnitude * MS_PER_SECOND, "ms")
    return Measure(magnitude, unit.ifEmpty { null })
}

private const val MS_PER_SECOND = 1000.0

/** Values are attacker-controlled; an error body repeats at most a recognisable prefix of one. */
private fun echo(value: String): String =
    if (value.length <= MAX_ECHOED_VALUE_LENGTH) {
        "'$value'"
    } else {
        "'${value.take(MAX_ECHOED_VALUE_LENGTH)}…'"
    }
