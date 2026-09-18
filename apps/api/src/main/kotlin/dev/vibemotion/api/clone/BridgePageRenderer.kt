package dev.vibemotion.api.clone

/**
 * Adds the bridge and the CSP to a stored page, at serve time.
 *
 * Nothing here is ever written back to `projects.base_html`: the stored document stays exactly what
 * [HtmlRewriter] produced, so a bridge or policy change takes effect on the next page view for every
 * project ever cloned, and a saved version keeps rendering the same markup it was saved against.
 *
 * Runs on every iframe load, so it is string insertion rather than a re-parse: the input is our own
 * normalised output, where `<head>` and `</body>` are exactly where jsoup put them.
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
        val headEnd = headOpenTagEnd(baseHtml)
        val bodyEnd = bodyCloseTagStart(baseHtml).coerceAtLeast(maxOf(headEnd, 0))
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

    /** The index just past `<head …>`, or -1 when the document has no head. */
    private fun headOpenTagEnd(html: String): Int {
        var from = 0
        while (true) {
            val start = html.indexOf("<head", from, ignoreCase = true)
            if (start < 0) return -1
            val after = start + HEAD_TAG.length
            // `<header>` also starts with `<head`.
            if (after >= html.length || html[after] == '>' || html[after].isWhitespace()) {
                val close = html.indexOf('>', start)
                return if (close < 0) -1 else close + 1
            }
            from = start + 1
        }
    }

    /** Where the bridge tag goes: just before `</body>`, else `</html>`, else at the very end. */
    private fun bodyCloseTagStart(html: String): Int {
        val body = html.lastIndexOf("</body", ignoreCase = true)
        if (body >= 0) return body
        val htmlClose = html.lastIndexOf("</html", ignoreCase = true)
        return if (htmlClose >= 0) htmlClose else html.length
    }

    private companion object {
        private const val HEAD_TAG = "<head"

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
