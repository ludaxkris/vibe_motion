package dev.vibemotion.api.clone

/**
 * Turns a stored `base_html` into the document served at `GET /projects/{id}/page` (the editor
 * iframe `src`). Adds, at serve time and never to the stored document:
 *
 *  - a Content-Security-Policy that forbids every script except the Vibe Motion bridge,
 *  - the bridge `<script>` tag, configured with the allowed parent (web) origin.
 *
 * Pure and cheap: it runs on every page view.
 */
fun interface PageRenderer {
    fun render(baseHtml: String): RenderedPage
}

data class RenderedPage(
    val html: String,
    /** Value for the `Content-Security-Policy` response header (the same policy is also in a meta tag). */
    val contentSecurityPolicy: String,
)
