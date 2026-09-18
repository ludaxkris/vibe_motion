package dev.vibemotion.api.clone

/**
 * The result of cloning a source page: a self-contained, script-free HTML document in which
 * every element under `<body>` carries a deterministic `data-vm-id`. Stored as
 * `projects.base_html` and never modified afterwards.
 *
 * The bridge script and the CSP are NOT part of this document. They are added at serve time by
 * [PageRenderer], so the bridge can evolve without touching stored projects.
 */
data class ClonedPage(
    val title: String,
    val html: String,
    /** The URL the content was finally served from, after redirects. */
    val finalUrl: String,
    /** Number of elements that received a `data-vm-id`. */
    val elementCount: Int,
)

/** Seam between the projects service and the clone pipeline. Implementations must be thread-safe. */
fun interface PageCloner {
    /**
     * Fetches and rewrites [url].
     *
     * @throws CloneException for every expected failure; anything else is a bug.
     */
    suspend fun clone(url: String): ClonedPage
}

/** Expected clone failures. Routes map each subtype to the status in `openapi.yaml`. */
sealed class CloneException(
    val code: String,
    message: String,
    cause: Throwable? = null,
) : RuntimeException(message, cause) {
    /** 400: not an absolute http(s) URL. */
    class InvalidUrl(
        message: String,
    ) : CloneException("invalid_url", message)

    /** 422: the SSRF guard refused the host (private, loopback, link-local, metadata, ...). */
    class Blocked(
        message: String,
    ) : CloneException("url_blocked", message)

    /** 422: DNS failure, connect failure, timeout, non-2xx, too many redirects. */
    class Unreachable(
        message: String,
        cause: Throwable? = null,
    ) : CloneException("url_unreachable", message, cause)

    /** 422: the response is not an HTML document. */
    class NotHtml(
        message: String,
    ) : CloneException("not_html", message)

    /** 413: the document exceeded `CLONE_MAX_BYTES`. */
    class TooLarge(
        message: String,
    ) : CloneException("page_too_large", message)
}
