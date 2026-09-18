package dev.vibemotion.api.model

import java.security.MessageDigest

/*
 * Strong entity tags for the two responses that are expensive to produce and cheap to validate:
 * the served project page (a multi-megabyte TOASTed column) and the bridge script.
 *
 * Strong, not weak: both responses are byte-for-byte reproducible from the inputs hashed here, so
 * there is nothing to be vague about. Neither response may be cached by freshness — a deleted
 * project must 404 and a CSP or bridge fix must take effect on the next request — so both are sent
 * `no-cache` and rely on revalidation, which is exactly what a validator is for.
 */

/** `"<sha-256 hex>"`, over [parts] joined by a separator that cannot occur inside them. */
internal fun strongETag(vararg parts: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
    parts.forEachIndexed { index, part ->
        if (index > 0) digest.update(0)
        digest.update(part.toByteArray(Charsets.UTF_8))
    }
    return digest.digest().joinToString(separator = "", prefix = "\"", postfix = "\"") { "%02x".format(it) }
}

/**
 * True when an `If-None-Match` header value matches [etag].
 *
 * Accepts the list form, `*`, and the `W/` prefix: a weak comparison is what `If-None-Match`
 * calls for, and a proxy or browser is free to send back a weakened form of what we issued.
 */
internal fun ifNoneMatch(
    header: String?,
    etag: String,
): Boolean {
    if (header.isNullOrBlank()) return false
    return header.split(',').any { candidate ->
        val trimmed = candidate.trim()
        trimmed == "*" || trimmed.removePrefix("W/") == etag.removePrefix("W/")
    }
}
