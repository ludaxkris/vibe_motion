package dev.vibemotion.api

import dev.vibemotion.api.clone.CloneException
import dev.vibemotion.api.clone.ClonedPage
import dev.vibemotion.api.clone.PageCloner
import dev.vibemotion.api.clone.PageRenderer
import dev.vibemotion.api.clone.RenderedPage

internal const val FAKE_CSP = "default-src 'self'; script-src 'nonce-vm'"

internal val FAKE_CLONE =
    ClonedPage(
        title = "Example Domain",
        html = "<html><head><title>Example Domain</title></head><body data-vm-id=\"vm-0\"><h1 data-vm-id=\"vm-1\">Hi</h1></body></html>",
        finalUrl = "https://example.com/",
        elementCount = 2,
    )

/**
 * Stands in for the clone pipeline, which lands in a parallel worktree.
 *
 * The projects service only cares about two things: that the fetch happens before the transaction
 * opens, and that a [CloneException] reaches the route unchanged. Both are exercised here without
 * a network.
 */
class FakePageCloner(
    var page: ClonedPage = FAKE_CLONE,
    var failure: (() -> CloneException)? = null,
) : PageCloner {
    val requestedUrls = mutableListOf<String>()

    override suspend fun clone(url: String): ClonedPage {
        requestedUrls += url
        failure?.let { throw it() }
        return page
    }

    fun reset() {
        page = FAKE_CLONE
        failure = null
        requestedUrls.clear()
    }
}

/** Marks the document so a test can tell the rendered page apart from the stored `base_html`. */
class FakePageRenderer(
    private val contentSecurityPolicy: String = FAKE_CSP,
) : PageRenderer {
    override fun render(baseHtml: String): RenderedPage =
        RenderedPage(
            html = baseHtml.replace("</body>", "<script src=\"/vm-bridge.js\"></script></body>"),
            contentSecurityPolicy = contentSecurityPolicy,
        )
}
