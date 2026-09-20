package dev.vibemotion.api.export

/*
 * The Kotlin twin of `apps/web/lib/runtime-css/declarations.ts`.
 *
 * The exporter emits a catalog entry's `baseStyles` verbatim, so it does not need to parse them to
 * do its job. It needs this to *check* them: that no entry declares an `animation*` or `--vm-*`
 * property (which would fight the assignment's own), and, in `ExportParityTest`, that Kotlin's
 * reading of the same declaration list matches TypeScript's parsed map exactly.
 *
 * Deliberately the same small algorithm rather than a CSS library: what it has to get right is only
 * what a declaration list can contain — `;` and `:` inside `()` (`linear-gradient(…)`,
 * `url(data:…;base64,…)`) or inside a quoted string are part of the value, not separators.
 */

/** Characters that open a nesting level a separator must not be read inside. */
private val CLOSERS = mapOf('(' to ')', '[' to ']', '{' to '}')

/**
 * `"transform-origin: center; backface-visibility: hidden;"` ->
 * `{ "transform-origin": "center", "backface-visibility": "hidden" }`.
 *
 * Property names and values are kept exactly as written (custom properties included); a fragment
 * with no `:` or an empty half is dropped, and a repeated property takes its last value, as a
 * browser would. Insertion order is preserved.
 */
internal fun parseDeclarations(css: String): Map<String, String> {
    val declarations = LinkedHashMap<String, String>()

    splitTopLevel(css, ';').forEach { fragment ->
        val halves = splitTopLevel(fragment, ':', limit = 1)
        if (halves.size < 2) return@forEach
        val property = halves[0].trim()
        val value = halves[1].trim()
        if (property.isEmpty() || value.isEmpty()) return@forEach
        // Matches JavaScript object assignment: a repeat overwrites in place, keeping first order.
        declarations[property] = value
    }

    return declarations
}

/**
 * Splits [css] on every top-level [separator], ignoring any inside brackets or a quoted string.
 * At most [limit] splits are made (`limit = 1` gives `["property", "rest of the value"]`).
 */
private fun splitTopLevel(
    css: String,
    separator: Char,
    limit: Int = Int.MAX_VALUE,
): List<String> {
    val parts = mutableListOf<String>()
    val stack = ArrayDeque<Char>()
    var quote: Char? = null
    var start = 0
    var index = 0

    while (index < css.length) {
        val character = css[index]
        if (quote != null) {
            when (character) {
                // The escaped character is part of the string, whatever it is.
                '\\' -> index++

                quote -> quote = null
            }
        } else if (character == '"' || character == '\'') {
            quote = character
        } else if (CLOSERS.containsKey(character)) {
            stack.addLast(checkNotNull(CLOSERS[character]))
        } else if (stack.isNotEmpty() && character == stack.last()) {
            stack.removeLast()
        } else if (character == separator && stack.isEmpty() && parts.size < limit) {
            parts += css.substring(start, index)
            start = index + 1
        }
        index++
    }

    parts += css.substring(start.coerceAtMost(css.length))
    return parts
}
