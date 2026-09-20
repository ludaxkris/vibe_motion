package dev.vibemotion.api.export

import dev.vibemotion.api.clone.HtmlRewriter
import dev.vibemotion.api.clone.HtmlSanitiser
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import org.jsoup.nodes.Element
import java.nio.charset.StandardCharsets

/**
 * `base_html` -> `index.html`.
 *
 * Three steps, in this order and no other:
 *
 * 1. **Map `data-vm-id` to classes.** Before sanitising, because the sanitiser takes the whole
 *    `data-vm-*` namespace back. The id travels on the element, so the mapping survives any tree
 *    shift the parser applies.
 * 2. **Sanitise** ([HtmlSanitiser]). `base_html` is immutable and may have been produced by an
 *    older rewriter; the export has no CSP behind it (DT-073), so today's removals are re-applied
 *    rather than assumed.
 * 3. **Link our files** into `<head>`. After sanitising, which removes every `<script>`.
 * 4. **Serialise** with the output settings the clone pipeline used.
 *
 * The document is re-parsed **unconditionally** rather than string-patched. jsoup is not
 * idempotent on its own output in general — `<plaintext>` re-escapes, `<pre>` loses a leading
 * newline, a nested `<form>` is dropped on a second parse, and
 * `<math><mtext><mglyph><style><img …>` is text on the first parse and an element on the second
 * (the mXSS class of bug). That is precisely the argument *for* re-parsing: a string pass would
 * hand those bytes to a browser with nothing in front of them. Byte identity with `base_html` is
 * therefore not a requirement; `HtmlRoundTripTest` characterises what actually changes.
 */
class HtmlEmitter(
    private val sanitiser: HtmlSanitiser = HtmlSanitiser(),
) {
    /**
     * @param classesByVmId the classes to append to each assigned element, in order. An element
     *   whose id is absent keeps its own classes and loses only the `data-vm-id`.
     * @param needsScript whether some assignment uses the `in-view` trigger, which is the only
     *   thing an exported page needs JavaScript for.
     */
    fun emit(
        baseHtml: String,
        classesByVmId: Map<String, List<String>>,
        needsScript: Boolean,
    ): String {
        val document = Jsoup.parse(baseHtml)
        document.outputSettings().prettyPrint(false).charset(StandardCharsets.UTF_8)

        if (classesByVmId.isNotEmpty()) {
            document.select("[${HtmlRewriter.VM_ID_ATTRIBUTE}]").forEach { element ->
                classesByVmId[element.attr(HtmlRewriter.VM_ID_ATTRIBUTE)]?.let { element.appendClasses(it) }
            }
        }

        // After sanitising, which removes every `<script>` and would take ours with it.
        sanitiser.sanitise(document)
        linkOurFiles(document, needsScript)

        return document.outerHtml()
    }

    /**
     * The stylesheet link last in `<head>`, then the script when it is needed.
     *
     * The script is **not** deferred: `vm-js` has to be on `<html>` before first paint, or an
     * `in-view` element in the first viewport paints at rest, snaps to its first keyframe when the
     * class lands, and then plays — the flash the hold rule exists to prevent. The cost is one
     * small render-blocking request. An inline script would avoid it but break hosts with a strict
     * CSP. This departs from the build plan's literal `defer`.
     *
     * Ours are removed first, so exporting a page that was exported (and re-cloned) once before
     * does not stack a second link.
     */
    private fun linkOurFiles(
        document: Document,
        needsScript: Boolean,
    ) {
        val head = document.head()
        head.select("""link[href="${CSS_FILE.name}"], script[src="${JS_FILE.name}"]""").remove()
        head.appendChild(Element("link").attr("rel", "stylesheet").attr("href", CSS_FILE.name))
        if (needsScript) head.appendChild(Element("script").attr("src", JS_FILE.name))
    }

    private companion object {
        /**
         * Appended, never replaced: cloned pages carry their own classes and their order is part
         * of the page's own cascade. A `class` attribute is created when the element has none.
         */
        private fun Element.appendClasses(classes: List<String>) {
            if (classes.isEmpty()) return
            val added = classes.joinToString(" ")
            val existing = attr("class")
            attr("class", if (existing.isBlank()) added else "$existing $added")
        }
    }
}
