package dev.vibemotion.api.clone

import org.jsoup.Jsoup
import org.jsoup.nodes.Comment
import org.jsoup.nodes.DataNode
import org.jsoup.nodes.Document
import org.jsoup.nodes.Element
import org.jsoup.nodes.Node
import org.jsoup.nodes.TextNode
import java.util.Locale

/**
 * Everything [HtmlRewriter] removes from a document that does not need a base URL, a stylesheet
 * fetcher or an id counter: `<noscript>` unwrapping, comments, executable elements, meta and link
 * removals, SMIL that retargets a URL, `on*` handlers, `ping`, dangerous navigation URLs,
 * dangerous `url()` in `style` attributes and `<style>` blocks, form normalisation, and the whole
 * `data-vm-*` namespace.
 *
 * It exists as its own class because two pipelines need exactly these removals and nothing else:
 *
 * - the **clone**, which then absolutises URLs, inlines stylesheets, adds a charset meta and
 *   numbers elements — none of which is possible without the page's final URL;
 * - the **export** (Phase 7), which has no base URL at all and must re-apply today's protections
 *   to a `base_html` row that an older rewriter produced. `base_html` is immutable and the export
 *   is served from the designer's own site with **no CSP** behind it (DT-073), so the clone-time
 *   removals are re-run rather than assumed.
 *
 * Base-free is the contract, not an accident: this class never resolves a URL, never fetches
 * anything, never assigns a `data-vm-id` and never adds a `<meta charset>`. It is idempotent, so
 * sanitising an already-sanitised document is a no-op.
 *
 * It is **not** a general-purpose sanitiser for untrusted HTML rendered on our own origin. It is
 * the set of removals that keep a cloned page a stable, inert canvas, with defence in depth second.
 */
class HtmlSanitiser {
    /**
     * Applies every base-free removal to [document], in place.
     *
     * [deadline] is checked between stages and, through [GuardedCharSequence], from inside the CSS
     * regexes, so a hostile stylesheet cannot pin a core past the clone's budget.
     */
    fun sanitise(
        document: Document,
        deadline: DeadlineCheck = DeadlineCheck.NONE,
    ) {
        unwrapNoscript(document)
        deadline.check()
        stripComments(document)
        deadline.check()
        removeUnsafeElements(document)
        deadline.check()
        cleanAttributes(document, deadline)
        deadline.check()
        defuseStyleBlocks(document, deadline)
        deadline.check()
        normaliseForms(document)
    }

    /**
     * `<noscript>` content is what the page wanted a script-less visitor to see, which is exactly
     * what we are building, so it is promoted rather than dropped. Some parses hand it back as one
     * text node of markup; that is re-parsed so the elements inside are cleaned like any other.
     */
    private fun unwrapNoscript(document: Document) {
        document.select("noscript").forEach { element ->
            val onlyChild = element.childNodes().singleOrNull() as? TextNode
            if (onlyChild != null && onlyChild.wholeText.contains('<')) {
                val parsed =
                    Jsoup
                        .parseBodyFragment(onlyChild.wholeText, element.baseUri())
                        .body()
                        .childNodes()
                        .toList()
                parsed.forEach(Node::remove)
                element.empty()
                element.insertChildren(0, parsed)
            }
            element.unwrap()
        }
    }

    /**
     * Comments are dropped, contents and all.
     *
     * Two reasons, and the first is not cosmetic: [BridgePageRenderer] finds its insertion points by
     * scanning the stored string, so a page ending in `<!-- </body -->` would put the bridge tag
     * inside a comment and that project would never come alive. The second is that a conditional
     * comment is markup a browser may still run — `<!--[if lt IE 9]><script …><![endif]-->` — so its
     * contents are dropped with it rather than promoted the way `<noscript>` is.
     *
     * Iterative: the depth of a cloned page is attacker-controlled.
     */
    private fun stripComments(document: Document) {
        val comments = mutableListOf<Node>()
        val stack = ArrayDeque<Node>()
        stack.addLast(document)
        while (stack.isNotEmpty()) {
            val node = stack.removeLast()
            if (node is Comment) {
                comments += node
                continue
            }
            node.childNodes().forEach(stack::addLast)
        }
        comments.forEach(Node::remove)
    }

    private fun removeUnsafeElements(document: Document) {
        document.select(REMOVED_TAGS.joinToString(",")).remove()
        document.select("meta[http-equiv]").forEach { meta ->
            val equiv = meta.attr("http-equiv").trim().lowercase(Locale.ROOT)
            if (equiv in REMOVED_META_EQUIVS) meta.remove()
        }
        document.select("link[rel]").forEach { link ->
            if (link.relTokens().any { it in REMOVED_LINK_RELS }) link.remove()
        }
        removeSmilAnimations(document)
    }

    /**
     * SMIL is scripting by another name: `<animate attributeName="xlink:href" to="javascript:…">`
     * rewrites a link's target *after* everything here has run, and `<set>` does it instantly.
     * Nothing in a cloned page needs SVG animation that retargets a link, so any such element goes,
     * as does any whose value list mentions a scheme we neutralise elsewhere.
     */
    private fun removeSmilAnimations(document: Document) {
        document.select(SMIL_TAGS.joinToString(",")).forEach { element ->
            val retargetsUrl = element.attr("attributeName").trim().lowercase(Locale.ROOT) in SMIL_URL_TARGETS
            val carriesScheme =
                SMIL_VALUE_ATTRIBUTES.any { attribute ->
                    element.hasAttr(attribute) && containsDangerousUrl(element.attr(attribute))
                }
            if (retargetsUrl || carriesScheme) element.remove()
        }
    }

    /**
     * One pass over every element: drop the attributes we must not keep and defuse dangerous URLs.
     *
     * Nothing here resolves a URL. The clone's absolutising pass runs after this one, per element,
     * in the same order it always did.
     */
    private fun cleanAttributes(
        document: Document,
        deadline: DeadlineCheck,
    ) {
        document.getAllElements().forEach { element ->
            element.attributes().map { it.key }.forEach { key ->
                val lower = key.lowercase(Locale.ROOT)
                if (isEventHandler(lower) || lower.startsWith(VM_ATTRIBUTE_PREFIX)) element.removeAttr(key)
            }
            // `ping` fires a POST to a third party on every click. Harmless under our CSP
            // (`connect-src 'none'`), live again the moment the export is on the designer's site.
            if (element.normalName() in PING_TAGS) element.removeAttr("ping")
            NAVIGATION_ATTRIBUTES.forEach { attribute ->
                if (element.hasAttr(attribute) && isDangerousUrl(element.attr(attribute))) {
                    element.attr(attribute, "#")
                }
            }
            if (element.hasAttr("style")) {
                element.attr("style", defuseDangerousCssUrls(element.attr("style"), deadline))
            }
        }
    }

    private fun defuseStyleBlocks(
        document: Document,
        deadline: DeadlineCheck,
    ) {
        document.select("style").forEach { style ->
            style.replaceData(defuseDangerousCssUrls(style.data(), deadline))
        }
    }

    private fun normaliseForms(document: Document) {
        document.select("form").forEach { form ->
            form.attr("action", "#")
            form.removeAttr("target")
        }
    }

    companion object {
        /**
         * Every quantifier in the CSS patterns here and in [HtmlRewriter] is bounded, because a
         * hostile stylesheet can be a megabyte of anything and an unbounded tail makes each failed
         * match attempt scan to end of input. See [HtmlRewriter] for the measurements.
         */
        internal const val CSS_TOKEN_MAX = "4096"

        internal const val VM_ATTRIBUTE_PREFIX = "data-vm-"

        private val REMOVED_TAGS = listOf("script", "iframe", "frame", "object", "embed", "applet", "base")
        private val REMOVED_META_EQUIVS = setOf("refresh", "content-security-policy")
        private val REMOVED_LINK_RELS =
            setOf("preload", "prefetch", "modulepreload", "dns-prefetch", "preconnect", "manifest")

        private val NAVIGATION_ATTRIBUTES = listOf("href", "src", "action", "formaction", "xlink:href")
        private val DANGEROUS_URL_PREFIXES = listOf("javascript:", "vbscript:", "data:text/html")
        private val PING_TAGS = setOf("a", "area")

        private val SMIL_TAGS = listOf("animate", "set", "animatetransform", "animatemotion")
        private val SMIL_URL_TARGETS = setOf("href", "xlink:href")
        private val SMIL_VALUE_ATTRIBUTES = listOf("from", "to", "by", "values")

        private val WHITESPACE = Regex("""\s+""")

        /**
         * A scripting scheme inside `url(…)`, swept before anything else is done to a stylesheet.
         *
         * It needs its own pattern because [HtmlRewriter]'s `url(…)` matcher deliberately refuses a
         * token containing `(`, and `url(javascript:alert(1))` is exactly that shape. Everything up
         * to the end of the declaration goes, which is what a browser does with a bad-url token
         * anyway. Bounded, and the alternation fails within a few characters of every ordinary
         * `url(`, so it is linear.
         */
        private val CSS_DANGEROUS_URL =
            Regex(
                """url\(\s*+["']?\s*+(?:javascript|vbscript|data:text/html)[^;{}]{0,$CSS_TOKEN_MAX}""",
                RegexOption.IGNORE_CASE,
            )

        /** Replaces every `url(javascript:…)`-shaped token with `url("#")`. Idempotent. */
        internal fun defuseDangerousCssUrls(
            css: String,
            deadline: DeadlineCheck,
        ): String {
            if (css.isEmpty()) return css
            return CSS_DANGEROUS_URL.replace(GuardedCharSequence(css, deadline), """url("#")""")
        }

        internal fun isEventHandler(lowerKey: String): Boolean =
            lowerKey.length > 2 && lowerKey.startsWith("on") && lowerKey.drop(2).all { it.isLetter() }

        /**
         * Whitespace and control characters are stripped before the check because `java\nscript:`
         * is a URL browsers happily navigate and a naive `startsWith` happily misses.
         */
        internal fun isDangerousUrl(value: String): Boolean {
            val normalised = normaliseUrlValue(value)
            return DANGEROUS_URL_PREFIXES.any { normalised.startsWith(it) }
        }

        /**
         * For values that are *lists* of URLs rather than one URL — a SMIL `values="a;b;c"`, where
         * the dangerous entry can sit anywhere — so `startsWith` is not enough.
         */
        private fun containsDangerousUrl(value: String): Boolean {
            val normalised = normaliseUrlValue(value)
            return DANGEROUS_URL_PREFIXES.any { normalised.contains(it) }
        }

        private fun normaliseUrlValue(value: String): String =
            value.filterNot { it.isWhitespace() || it.code < 0x20 }.lowercase(Locale.ROOT)

        internal fun Element.relTokens(): Set<String> {
            val tokens = attr("rel").lowercase(Locale.ROOT).split(WHITESPACE)
            return tokens.filterTo(mutableSetOf()) { it.isNotEmpty() }
        }

        internal fun Element.replaceData(data: String) {
            empty()
            appendChild(DataNode(data))
        }
    }
}
