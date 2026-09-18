package dev.vibemotion.api.clone

import org.jsoup.Jsoup
import org.jsoup.nodes.Comment
import org.jsoup.nodes.DataNode
import org.jsoup.nodes.Document
import org.jsoup.nodes.Element
import org.jsoup.nodes.Node
import org.jsoup.nodes.TextNode
import java.nio.charset.StandardCharsets
import java.util.Locale

/**
 * What one stylesheet fetch produced.
 *
 * The distinction that matters is [Blocked] versus [Unavailable]. A stylesheet is never worth
 * failing a clone over, so an ordinary failure just leaves the `<link>` in place and absolute. But
 * a URL the [SsrfGuard] *refused* must not survive as a link either: the exporter (Phase 7) hands
 * the stored document to a designer's own site, where there is no CSP and the browser would
 * cheerfully fetch the internal host we declined to fetch ourselves.
 */
sealed interface StylesheetFetch {
    /** The sheet came back and can be inlined. */
    data class Loaded(
        val stylesheet: LoadedStylesheet,
    ) : StylesheetFetch

    /** The guard refused this URL, on the first hop or after a redirect. The `<link>` is dropped. */
    data object Blocked : StylesheetFetch

    /** 404, timeout, wrong content type, over the cap: keep the absolute `<link>` and move on. */
    data object Unavailable : StylesheetFetch
}

/** Fetches one stylesheet. Every failure mode is reported rather than thrown. */
typealias StylesheetLoader = (url: String) -> StylesheetFetch

/**
 * Turns a fetched page into the self-contained, script-free document stored as `projects.base_html`.
 *
 * Every step is deterministic: the same bytes in produce the same bytes out, which is what lets the
 * exporter and the golden tests treat `base_html` as a stable artefact and lets `data-vm-id` be the
 * project's element identity for its whole life.
 *
 * What it is *not*: a sanitiser for untrusted HTML rendered on our own origin. The cloned page is
 * served from the API origin under a CSP that forbids scripts other than the bridge
 * ([BridgePageRenderer]); the removals here are about a stable canvas, with defence in depth second.
 */
class HtmlRewriter(
    private val maxStylesheets: Int = DEFAULT_MAX_STYLESHEETS,
    private val maxCssBytes: Int = DEFAULT_MAX_CSS_BYTES,
) {
    fun rewrite(
        html: String,
        finalUrl: String,
        loadStylesheet: StylesheetLoader,
        deadline: DeadlineCheck = DeadlineCheck.NONE,
    ): ClonedPage {
        val document = Jsoup.parse(html, finalUrl)
        document.outputSettings().prettyPrint(false).charset(StandardCharsets.UTF_8)
        // `head()`/`body()` create the element when the source had none, so every later step can
        // assume both exist.
        document.head()
        document.body()

        // `<base href>` is honoured for resolution and then deleted, so the stored document cannot
        // later re-point every relative URL that survived.
        val base = effectiveBase(document, finalUrl)
        document.setBaseUri(base)

        // Between stages, not inside them: each is a bounded pass over a document that is already
        // capped, so this is enough to keep the CPU half of a clone inside the clone's budget.
        unwrapNoscript(document)
        deadline.check()
        stripComments(document)
        deadline.check()
        removeUnsafeElements(document)
        deadline.check()
        cleanAttributes(document, base)
        deadline.check()
        rewriteStyleBlocks(document, base)
        deadline.check()
        inlineStylesheets(document, loadStylesheet, deadline)
        deadline.check()
        normaliseForms(document)
        ensureCharsetMeta(document)
        val elementCount = assignVmIds(document)

        return ClonedPage(
            title = document.title().trim().ifBlank { hostOfUrl(finalUrl) },
            html = document.outerHtml(),
            finalUrl = finalUrl,
            elementCount = elementCount,
        )
    }

    private fun effectiveBase(
        document: Document,
        finalUrl: String,
    ): String {
        val declared = document.selectFirst("base[href]") ?: return finalUrl
        val href = declared.attr("href").trim()
        if (href.isEmpty()) return finalUrl
        return resolveUrl(finalUrl, href) ?: finalUrl
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
     * One pass over every element: drop what we must not keep, defuse dangerous URLs, and make
     * everything that is left absolute so the stored document renders from our origin.
     */
    private fun cleanAttributes(
        document: Document,
        base: String,
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
            URL_ATTRIBUTES.forEach { attribute ->
                if (element.hasAttr(attribute)) {
                    resolveUrl(base, element.attr(attribute))?.let { element.attr(attribute, it) }
                }
            }
            SRCSET_ATTRIBUTES.forEach { attribute ->
                if (element.hasAttr(attribute)) {
                    element.attr(attribute, rewriteSrcset(element.attr(attribute), base))
                }
            }
            if (element.hasAttr("style")) {
                element.attr("style", absolutiseCss(element.attr("style"), base))
            }
        }
    }

    private fun rewriteStyleBlocks(
        document: Document,
        base: String,
    ) {
        document.select("style").forEach { style ->
            style.replaceData(absolutiseCss(style.data(), base))
        }
    }

    /**
     * Replaces `<link rel=stylesheet>` with the stylesheet itself, so the stored document needs
     * nothing from the source origin to render.
     *
     * Bounded by [maxStylesheets] and [maxCssBytes] together: a page with a hundred sheets, or one
     * sheet of 50 MB, must not turn one clone into an unbounded fetch. Anything that does not fit,
     * fails, or is not CSS keeps its (absolute) `<link>` — a page that renders through the source
     * origin beats a clone that fails.
     */
    private fun inlineStylesheets(
        document: Document,
        loadStylesheet: StylesheetLoader,
        deadline: DeadlineCheck,
    ) {
        val budget = CssBudget(maxStylesheets, maxCssBytes)
        document.select("link[rel]").forEach { link ->
            val tokens = link.relTokens()
            if ("stylesheet" !in tokens || "alternate" in tokens || link.hasAttr("disabled")) return@forEach
            val href = link.attr("href").trim()
            if (!href.startsWith("http", ignoreCase = true)) return@forEach
            if (!budget.claimFetch()) return@forEach
            deadline.check()
            val sheet =
                when (val fetched = loadStylesheet(href)) {
                    is StylesheetFetch.Loaded -> {
                        fetched.stylesheet
                    }

                    StylesheetFetch.Blocked -> {
                        // The guard refused this host; an export must not ask a browser to try it.
                        link.remove()
                        return@forEach
                    }

                    StylesheetFetch.Unavailable -> {
                        return@forEach
                    }
                }
            if (!budget.consume(sheet.css)) return@forEach

            val inlined = absolutiseCss(inlineImports(sheet.css, sheet.url, loadStylesheet, budget), sheet.url)
            val media = link.attr("media").trim()
            val css =
                if (media.isEmpty() || media.equals("all", ignoreCase = true)) inlined else "@media $media {\n$inlined\n}"
            val style = Element("style").attr("data-vm-source", href)
            style.appendChild(DataNode(neutraliseStyleTerminator(css)))
            link.replaceWith(style)
        }
    }

    /**
     * Inlines `@import` one level deep. Deeper imports are absolutised and left in place: the
     * browser will fetch them, and recursing further is how a stylesheet graph becomes a fetch storm.
     */
    private fun inlineImports(
        css: String,
        sheetUrl: String,
        loadStylesheet: StylesheetLoader,
        budget: CssBudget,
    ): String =
        IMPORT_RULE.replace(css) { match ->
            val reference = match.firstGroup(IMPORT_URL_GROUPS) ?: return@replace match.value
            val target = resolveUrl(sheetUrl, reference) ?: return@replace match.value
            if (!target.startsWith("http", ignoreCase = true) || !budget.claimFetch()) return@replace match.value
            val imported =
                when (val fetched = loadStylesheet(target)) {
                    is StylesheetFetch.Loaded -> fetched.stylesheet

                    // Dropping the rule, not keeping it: same reasoning as a blocked `<link>`.
                    StylesheetFetch.Blocked -> return@replace ""

                    StylesheetFetch.Unavailable -> return@replace match.value
                }
            if (!budget.consume(imported.css)) return@replace match.value

            val body = absolutiseCss(imported.css, imported.url)
            val media = match.groupValues[IMPORT_MEDIA_GROUP].trim()
            if (media.isEmpty()) body else "@media $media {\n$body\n}"
        }

    private fun normaliseForms(document: Document) {
        document.select("form").forEach { form ->
            form.attr("action", "#")
            form.removeAttr("target")
        }
    }

    private fun ensureCharsetMeta(document: Document) {
        document.select("meta[charset]").forEach { it.remove() }
        document.select("meta[http-equiv]").forEach { meta ->
            if (meta.attr("http-equiv").trim().equals("content-type", ignoreCase = true)) meta.remove()
        }
        document.head().prependChild(Element("meta").attr("charset", "utf-8"))
    }

    /**
     * Numbers every element under `<body>` depth-first, pre-order, from 1. Iterative because the
     * depth of a cloned page is attacker-controlled and a recursive walk is a stack overflow away.
     *
     * Skipped: elements with nothing to animate ([ID_SKIPPED_TAGS]). Opaque: `<svg>` and
     * `<template>` get an id but their contents do not — animating an SVG's internals or a
     * template's inert copy is not a v0 flow, and both would inflate the id space for nothing.
     */
    private fun assignVmIds(document: Document): Int {
        var next = 1
        val stack = ArrayDeque<Element>()
        val roots = document.body().children()
        roots.reversed().forEach(stack::addLast)
        while (stack.isNotEmpty()) {
            val element = stack.removeLast()
            val name = element.normalName()
            if (name in ID_SKIPPED_TAGS) continue
            element.attr(VM_ID_ATTRIBUTE, "vm-${next++}")
            if (name in ID_OPAQUE_TAGS) continue
            element.children().reversed().forEach(stack::addLast)
        }
        return next - 1
    }

    /**
     * Fetch and byte budget shared by a page's `<link>` sheets and their first-level imports.
     *
     * An *attempt* spends a fetch, not a success: counting only the sheets that came back would let
     * a page of a thousand dead stylesheet links cost a thousand round trips, which is exactly the
     * fetch storm [maxStylesheets] exists to prevent.
     */
    private class CssBudget(
        private var sheets: Int,
        private var bytes: Int,
    ) {
        fun claimFetch(): Boolean {
            if (sheets <= 0) return false
            sheets--
            return true
        }

        fun consume(css: String): Boolean {
            if (css.length > bytes) return false
            bytes -= css.length
            return true
        }
    }

    companion object {
        const val DEFAULT_MAX_STYLESHEETS: Int = 30
        const val DEFAULT_MAX_CSS_BYTES: Int = 3 * 1024 * 1024
        const val VM_ID_ATTRIBUTE: String = "data-vm-id"

        private const val VM_ATTRIBUTE_PREFIX = "data-vm-"
        private const val IMPORT_MEDIA_GROUP = 6

        private val IMPORT_URL_GROUPS = 1..5

        private val REMOVED_TAGS = listOf("script", "iframe", "frame", "object", "embed", "applet", "base")
        private val REMOVED_META_EQUIVS = setOf("refresh", "content-security-policy")
        private val REMOVED_LINK_RELS =
            setOf("preload", "prefetch", "modulepreload", "dns-prefetch", "preconnect", "manifest")

        private val URL_ATTRIBUTES = listOf("href", "src", "poster", "action", "data", "formaction", "xlink:href")
        private val NAVIGATION_ATTRIBUTES = listOf("href", "src", "action", "formaction", "xlink:href")
        private val SRCSET_ATTRIBUTES = listOf("srcset", "imagesrcset")
        private val DANGEROUS_URL_PREFIXES = listOf("javascript:", "vbscript:", "data:text/html")
        private val PING_TAGS = setOf("a", "area")

        private val SMIL_TAGS = listOf("animate", "set", "animatetransform", "animatemotion")
        private val SMIL_URL_TARGETS = setOf("href", "xlink:href")
        private val SMIL_VALUE_ATTRIBUTES = listOf("from", "to", "by", "values")

        private val ID_SKIPPED_TAGS = setOf("style", "link", "meta", "br", "wbr", "script", "noscript")
        private val ID_OPAQUE_TAGS = setOf("svg", "template")

        private val WHITESPACE = Regex("""\s+""")

        /**
         * Every quantifier below is bounded, and the unquoted `url(` token excludes `(` as well as
         * `)`. Both matter against a hostile stylesheet, which can be up to a megabyte of anything:
         * an unbounded `[^x]*` tail makes each failed match attempt scan to end of input, which is
         * quadratic. Measured on 512 KB of `url(` repeated: 380 s before, 12 ms after; on 512 KB of
         * `@import "a" ` with no semicolons: 32 s before, 0.26 s after. Excluding `(` is also what
         * CSS says: an unquoted url token cannot contain one.
         *
         * The cost of bounding is that a pathological token longer than [CSS_TOKEN_MAX] is left
         * exactly as written rather than absolutised, which is what happens to anything unparseable
         * here anyway.
         */
        private const val CSS_TOKEN_MAX = "4096"
        private const val IMPORT_TAIL_MAX = "1024"
        private const val URL_TOKEN =
            """(?:"([^"]{0,$CSS_TOKEN_MAX})"|'([^']{0,$CSS_TOKEN_MAX})'|([^()"'\s]{0,$CSS_TOKEN_MAX}))"""

        private val CSS_URL = Regex("""url\(\s*$URL_TOKEN\s*\)""", RegexOption.IGNORE_CASE)

        /**
         * A scripting scheme inside `url(…)`, swept before anything else in [absolutiseCss].
         *
         * It needs its own pattern because [CSS_URL] deliberately refuses a token containing `(`,
         * and `url(javascript:alert(1))` is exactly that shape. Everything up to the end of the
         * declaration goes, which is what a browser does with a bad-url token anyway. Bounded, and
         * the alternation fails within a few characters of every ordinary `url(`, so it is linear.
         */
        private val CSS_DANGEROUS_URL =
            Regex(
                """url\(\s*["']?\s*(?:javascript|vbscript|data:text/html)[^;{}]{0,$CSS_TOKEN_MAX}""",
                RegexOption.IGNORE_CASE,
            )
        private val CSS_IMPORT_STRING =
            Regex(
                """@import\s+(?:"([^"]{0,$CSS_TOKEN_MAX})"|'([^']{0,$CSS_TOKEN_MAX})')""",
                RegexOption.IGNORE_CASE,
            )
        private val IMPORT_RULE =
            Regex(
                """@import\s+(?:url\(\s*$URL_TOKEN\s*\)|"([^"]{0,$CSS_TOKEN_MAX})"|""" +
                    """'([^']{0,$CSS_TOKEN_MAX})')([^;{}]{0,$IMPORT_TAIL_MAX});""",
                RegexOption.IGNORE_CASE,
            )
        private val STYLE_TERMINATOR = Regex("</style", RegexOption.IGNORE_CASE)

        private fun isEventHandler(lowerKey: String): Boolean =
            lowerKey.length > 2 && lowerKey.startsWith("on") && lowerKey.drop(2).all { it.isLetter() }

        /**
         * Whitespace and control characters are stripped before the check because `java\nscript:`
         * is a URL browsers happily navigate and a naive `startsWith` happily misses.
         */
        private fun isDangerousUrl(value: String): Boolean {
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

        private fun Element.relTokens(): Set<String> {
            val tokens = attr("rel").lowercase(Locale.ROOT).split(WHITESPACE)
            return tokens.filterTo(mutableSetOf()) { it.isNotEmpty() }
        }

        private fun Element.replaceData(data: String) {
            empty()
            appendChild(DataNode(data))
        }

        private fun MatchResult.firstGroup(indices: IntRange): String? =
            indices.firstNotNullOfOrNull { groupValues.getOrNull(it)?.takeIf(String::isNotEmpty) }

        /** Absolutises every `url(...)` and string-form `@import` in a stylesheet or style attribute. */
        private fun absolutiseCss(
            css: String,
            base: String,
        ): String {
            if (css.isEmpty()) return css
            val defused = CSS_DANGEROUS_URL.replace(css, """url("#")""")
            val withUrls =
                CSS_URL.replace(defused) { match ->
                    val reference = match.firstGroup(1..3) ?: return@replace match.value
                    if (isDangerousUrl(reference)) return@replace """url("#")"""
                    val absolute = resolveUrl(base, reference) ?: return@replace match.value
                    "url(\"${absolute.replace("\"", "%22")}\")"
                }
            return CSS_IMPORT_STRING.replace(withUrls) { match ->
                val reference = match.firstGroup(1..2) ?: return@replace match.value
                val absolute = resolveUrl(base, reference) ?: return@replace match.value
                "@import \"${absolute.replace("\"", "%22")}\""
            }
        }

        /**
         * A stylesheet that contains the characters `</style` would otherwise close the element we
         * are putting it inside and dump the rest of the sheet into the DOM as markup.
         */
        private fun neutraliseStyleTerminator(css: String): String = STYLE_TERMINATOR.replace(css) { """<\/style""" }

        /**
         * The HTML `srcset` parsing algorithm: skip separators, take the URL up to whitespace, then
         * the descriptor up to the next comma. Left alone when a `data:` URI is present, because a
         * base64 payload is full of the commas this split relies on.
         */
        private fun rewriteSrcset(
            value: String,
            base: String,
        ): String {
            if (value.contains("data:", ignoreCase = true)) return value
            val candidates = mutableListOf<String>()
            var index = 0
            while (index < value.length) {
                while (index < value.length && (value[index].isWhitespace() || value[index] == ',')) index++
                if (index >= value.length) break
                val start = index
                while (index < value.length && !value[index].isWhitespace()) index++
                val token = value.substring(start, index)
                val url = token.trimEnd(',')
                var descriptor = ""
                if (!token.endsWith(",")) {
                    val descriptorStart = index
                    while (index < value.length && value[index] != ',') index++
                    descriptor = value.substring(descriptorStart, index).trim()
                    if (index < value.length) index++
                }
                if (url.isEmpty()) continue
                val absolute = resolveUrl(base, url) ?: url
                candidates += if (descriptor.isEmpty()) absolute else "$absolute $descriptor"
            }
            return if (candidates.isEmpty()) value else candidates.joinToString(", ")
        }
    }
}
