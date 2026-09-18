package dev.vibemotion.api.clone

import org.jsoup.Jsoup
import org.jsoup.nodes.DataNode
import org.jsoup.nodes.Document
import org.jsoup.nodes.Element
import org.jsoup.nodes.Node
import org.jsoup.nodes.TextNode
import java.nio.charset.StandardCharsets
import java.util.Locale

/**
 * Fetches one stylesheet, or returns null when it could not be had. A stylesheet is never worth
 * failing a clone over, so every failure mode collapses to null here.
 */
typealias StylesheetLoader = (url: String) -> LoadedStylesheet?

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

        unwrapNoscript(document)
        removeUnsafeElements(document)
        cleanAttributes(document, base)
        rewriteStyleBlocks(document, base)
        inlineStylesheets(document, loadStylesheet)
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

    private fun removeUnsafeElements(document: Document) {
        document.select(REMOVED_TAGS.joinToString(",")).remove()
        document.select("meta[http-equiv]").forEach { meta ->
            val equiv = meta.attr("http-equiv").trim().lowercase(Locale.ROOT)
            if (equiv in REMOVED_META_EQUIVS) meta.remove()
        }
        document.select("link[rel]").forEach { link ->
            if (link.relTokens().any { it in REMOVED_LINK_RELS }) link.remove()
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
    ) {
        val budget = CssBudget(maxStylesheets, maxCssBytes)
        document.select("link[rel]").forEach { link ->
            val tokens = link.relTokens()
            if ("stylesheet" !in tokens || "alternate" in tokens || link.hasAttr("disabled")) return@forEach
            val href = link.attr("href").trim()
            if (!href.startsWith("http", ignoreCase = true)) return@forEach
            if (!budget.canFetch()) return@forEach
            val sheet = loadStylesheet(href) ?: return@forEach
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
            if (!target.startsWith("http", ignoreCase = true) || !budget.canFetch()) return@replace match.value
            val imported = loadStylesheet(target) ?: return@replace match.value
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

    /** Fetch and byte budget shared by a page's `<link>` sheets and their first-level imports. */
    private class CssBudget(
        private var sheets: Int,
        private var bytes: Int,
    ) {
        fun canFetch(): Boolean = sheets > 0

        fun consume(css: String): Boolean {
            sheets--
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

        private val ID_SKIPPED_TAGS = setOf("style", "link", "meta", "br", "wbr", "script", "noscript")
        private val ID_OPAQUE_TAGS = setOf("svg", "template")

        private val WHITESPACE = Regex("""\s+""")
        private val CSS_URL =
            Regex("""url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)""", RegexOption.IGNORE_CASE)
        private val CSS_IMPORT_STRING =
            Regex("""@import\s+(?:"([^"]*)"|'([^']*)')""", RegexOption.IGNORE_CASE)
        private val IMPORT_RULE =
            Regex(
                """@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)|"([^"]*)"|'([^']*)')([^;]*);""",
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
            val normalised =
                value.filterNot { it.isWhitespace() || it.code < 0x20 }.lowercase(Locale.ROOT)
            return DANGEROUS_URL_PREFIXES.any { normalised.startsWith(it) }
        }

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
            val withUrls =
                CSS_URL.replace(css) { match ->
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
