package dev.vibemotion.api.clone

/**
 * Adds the bridge and the CSP to a stored page, at serve time.
 *
 * Nothing here is ever written back to `projects.base_html`: the stored document stays exactly what
 * [HtmlRewriter] produced, so a bridge or policy change takes effect on the next page view for every
 * project ever cloned, and a saved version keeps rendering the same markup it was saved against.
 *
 * Runs on every iframe load, so it is string insertion rather than a re-parse: the input is our own
 * normalised output, where `<head>` and `</body>` are exactly where jsoup put them. The one thing
 * the scan has to understand is comments — see [insertionPoints].
 */
class BridgePageRenderer(
    webOrigin: String,
    bridgePath: String = BridgeAssets.BRIDGE_PATH,
) : PageRenderer {
    private val safeOrigin = webOrigin.filterNot { it.isWhitespace() || it == ';' || it == ',' }

    /**
     * `frame-ancestors` is ignored in a `<meta>` policy, so the two differ on purpose: the header
     * carries it (and is what actually keeps the clone out of any frame but the editor's), the meta
     * tag carries the rest as a backstop for anything that saves or re-serves the HTML alone.
     */
    private val metaPolicy = BASE_POLICY

    private val headerPolicy = "$BASE_POLICY; frame-ancestors $safeOrigin"

    private val cspMeta = """<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(metaPolicy)}">"""

    private val bridgeTag =
        """<script src="${escapeAttribute(bridgePath)}" data-vm-parent-origin="${escapeAttribute(safeOrigin)}" defer></script>"""

    override fun render(baseHtml: String): RenderedPage {
        val (headEnd, bodyStart) = insertionPoints(baseHtml)
        val bodyEnd = bodyStart.coerceAtLeast(maxOf(headEnd, 0))
        val html =
            StringBuilder(baseHtml.length + cspMeta.length + bridgeTag.length + 2).apply {
                when {
                    headEnd < 0 -> append(cspMeta).append(baseHtml, 0, bodyEnd)
                    else -> append(baseHtml, 0, headEnd).append(cspMeta).append(baseHtml, headEnd, bodyEnd)
                }
                append(bridgeTag)
                append(baseHtml, bodyEnd, baseHtml.length)
            }
        return RenderedPage(html = html.toString(), contentSecurityPolicy = headerPolicy)
    }

    /**
     * Both insertion points, in one forward pass that steps over `<!-- … -->` spans.
     *
     * Comments matter because they are markup that looks like markup. A page ending in
     * `<!-- </body -->` would otherwise capture the bridge tag inside a comment and that project
     * would never send `ready`; a leading `<!-- <head> -->` would swallow the CSP meta the same way.
     * [HtmlRewriter] strips comments at clone time, so this only has to cover rows stored before
     * that — but `base_html` is immutable, so those rows are forever.
     *
     * The head is the first `<head …>` outside a comment; the body point is the *last* `</body`,
     * else the last `</html`, else the end of the document.
     */
    private fun insertionPoints(html: String): InsertionPoints {
        var headEnd = -1
        var lastBody = -1
        var lastHtml = -1
        var at = 0
        while (at < html.length) {
            val tag = html.indexOf('<', at)
            if (tag < 0) break
            if (html.startsWith(COMMENT_OPEN, tag)) {
                val close = html.indexOf(COMMENT_CLOSE, tag + COMMENT_OPEN.length)
                at = if (close < 0) html.length else close + COMMENT_CLOSE.length
                continue
            }
            when {
                headEnd < 0 && html.isTagAt(tag, HEAD_TAG) -> {
                    val close = html.indexOf('>', tag)
                    if (close >= 0) headEnd = close + 1
                }

                html.isTagAt(tag, BODY_CLOSE_TAG) -> {
                    lastBody = tag
                }

                html.isTagAt(tag, HTML_CLOSE_TAG) -> {
                    lastHtml = tag
                }
            }
            at = tag + 1
        }
        val bodyStart =
            when {
                lastBody >= 0 -> lastBody
                lastHtml >= 0 -> lastHtml
                else -> html.length
            }
        return InsertionPoints(headEnd, bodyStart)
    }

    private data class InsertionPoints(
        /** The index just past `<head …>`, or -1 when the document has no head. */
        val headEnd: Int,
        /** Where the bridge tag goes. */
        val bodyStart: Int,
    )

    private companion object {
        private const val HEAD_TAG = "<head"
        private const val BODY_CLOSE_TAG = "</body"
        private const val HTML_CLOSE_TAG = "</html"
        private const val COMMENT_OPEN = "<!--"
        private const val COMMENT_CLOSE = "-->"

        /**
         * [tag] must be followed by a tag-name boundary, or `<header>` would pass for `<head`.
         */
        private fun String.isTagAt(
            at: Int,
            tag: String,
        ): Boolean {
            if (!regionMatches(at, tag, 0, tag.length, ignoreCase = true)) return false
            val after = at + tag.length
            return after >= length || this[after] == '>' || this[after].isWhitespace()
        }

        /**
         * `default-src 'none'` and then only what a static rendering of someone else's page needs.
         * `script-src 'self'` admits exactly one script — the bridge, served from this origin —
         * which is what makes "third-party scripts are stripped" hold even if one survives the
         * rewrite. `style-src` allows http(s) because a stylesheet that could not be inlined is
         * still linked, and `'unsafe-inline'` because the page's own inline styles are the design.
         */
        private const val BASE_POLICY =
            "default-src 'none'; script-src 'self'; style-src 'unsafe-inline' https: http:; " +
                "img-src * data: blob:; font-src * data:; media-src * data: blob:; connect-src 'none'; " +
                "frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

        private fun escapeAttribute(value: String): String =
            value
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
    }
}
