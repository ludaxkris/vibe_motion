package dev.vibemotion.api.clone

import java.net.URI
import java.nio.charset.StandardCharsets
import java.util.Locale

private const val ILLEGAL_URI_CHARACTERS = "\"<>{}|\\^`"
private const val LOWEST_LEGAL_CHARACTER = 0x20
private const val HIGHEST_LEGAL_CHARACTER = 0x7E
private val HEX_DIGITS = "0123456789ABCDEF".toCharArray()

/**
 * Schemes whose values are self-contained and must survive untouched. `javascript:` and
 * `vbscript:` are here so a rewrite cannot accidentally resurrect one; they are neutralised
 * separately, before anything is absolutised.
 */
private val OPAQUE_SCHEMES =
    listOf("data:", "blob:", "mailto:", "tel:", "about:", "javascript:", "vbscript:", "sms:", "callto:")

/**
 * Resolves [reference] against [base].
 *
 * Returns null when the reference must be left exactly as written — an empty value, a bare
 * fragment (`#panel`, and `url(#gradient)` inside SVG, which break if made absolute), or an opaque
 * scheme — or when it simply cannot be resolved. Callers treat null as "leave this attribute
 * alone", so a URL this function cannot parse is never silently corrupted.
 */
internal fun resolveUrl(
    base: String,
    reference: String,
): String? {
    val value = reference.trim()
    if (value.isEmpty() || value.startsWith("#")) return null
    val lower = value.lowercase(Locale.ROOT)
    if (OPAQUE_SCHEMES.any { lower.startsWith(it) }) return null

    val encoded = encodeIllegalCharacters(value)
    return runCatching { URI(base).resolve(encoded).toString() }
        .recover { _ -> runCatching { URI(encoded).takeIf(URI::isAbsolute)?.toString() }.getOrNull() }
        .getOrNull()
}

/** The host of an absolute URL, or an empty string when there is not one. */
internal fun hostOfUrl(url: String): String = runCatching { URI(url).host.orEmpty() }.getOrDefault("")

/**
 * Percent-encodes the characters [URI] refuses — spaces, control characters, `{}|\^`"<>` and
 * anything non-ASCII — and nothing else, so an already-encoded URL is never double-encoded.
 */
private fun encodeIllegalCharacters(value: String): String {
    val needsEncoding =
        value.any { it.code < LOWEST_LEGAL_CHARACTER || it.code > HIGHEST_LEGAL_CHARACTER || it in ILLEGAL_URI_CHARACTERS }
    if (!needsEncoding) return value
    return buildString(value.length + 8) {
        value.forEach { character ->
            val illegal =
                character.code < LOWEST_LEGAL_CHARACTER ||
                    character.code > HIGHEST_LEGAL_CHARACTER ||
                    character in ILLEGAL_URI_CHARACTERS
            if (!illegal) {
                append(character)
            } else {
                character.toString().toByteArray(StandardCharsets.UTF_8).forEach { byte ->
                    val octet = byte.toInt() and 0xFF
                    append('%')
                    append(HEX_DIGITS[octet shr 4])
                    append(HEX_DIGITS[octet and 0x0F])
                }
            }
        }
    }
}
