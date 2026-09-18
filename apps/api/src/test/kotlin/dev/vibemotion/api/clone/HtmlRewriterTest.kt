package dev.vibemotion.api.clone

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.comparables.shouldBeLessThan
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import java.nio.file.Files
import java.nio.file.Path
import kotlin.system.measureTimeMillis

private const val MARKETING_URL = "https://www.northwind.example/marketing/index.html"
private const val DOCS_URL = "https://docs.example.org/guide/getting-started.html"
private const val HOSTILE_URL = "https://hostile.example/index.html"
private const val EXAMPLE_URL = "https://example.com/"
private const val EXAMPLE_SHEET = "https://example.com/hostile.css"
private const val HOSTILE_SHEET_BYTES = 512 * 1024

private fun linkTo(href: String): String = """<html><head><link rel="stylesheet" href="$href"></head><body><p>x</p></body></html>"""

/** Nothing in a cloned page may still be a script, or still look like one. */
private val SCRIPT_TAG = Regex("<script", RegexOption.IGNORE_CASE)
private val EVENT_HANDLER = Regex(""" on[a-z]+\s*=""", RegexOption.IGNORE_CASE)

class HtmlRewriterTest :
    FunSpec({

        val rewriter = HtmlRewriter()

        val docsStylesheets =
            mapOf(
                "https://docs.example.org/guide/assets/site.css" to fixture("site.css"),
                "https://docs.example.org/guide/assets/typography.css" to fixture("typography.css"),
            )

        val marketingStylesheets =
            mapOf(
                "https://www.northwind.example/assets/marketing.css" to ".brand { color: rebeccapurple }",
                "https://www.northwind.example/assets/print.css" to "body { color: black }",
            )

        val pages =
            listOf(
                Triple("marketing.html", MARKETING_URL, marketingStylesheets),
                Triple("docs.html", DOCS_URL, docsStylesheets),
                Triple("hostile.html", HOSTILE_URL, emptyMap()),
            )

        test("marketing page: golden output") {
            val cloned = rewriter.rewrite(fixture("marketing.html"), MARKETING_URL, loaderFor(marketingStylesheets))

            cloned.title shouldBe "Northwind — Ship faster"
            assertGolden("marketing.html", cloned.html)
        }

        test("docs page: golden output") {
            val cloned = rewriter.rewrite(fixture("docs.html"), DOCS_URL, loaderFor(docsStylesheets))

            cloned.title shouldBe "Getting started"
            assertGolden("docs.html", cloned.html)
        }

        test("hostile page: golden output") {
            val cloned = rewriter.rewrite(fixture("hostile.html"), HOSTILE_URL, loaderFor(emptyMap()))

            assertGolden("hostile.html", cloned.html)
        }

        test("the same input twice produces byte-identical output") {
            pages.forEach { (name, url, sheets) ->
                withClue(name) {
                    val first = rewriter.rewrite(fixture(name), url, loaderFor(sheets))
                    val second = rewriter.rewrite(fixture(name), url, loaderFor(sheets))
                    second.html shouldBe first.html
                    second.elementCount shouldBe first.elementCount
                }
            }
        }

        test("no page keeps a script tag, an inline event handler or a scripting URL") {
            pages.forEach { (name, url, sheets) ->
                withClue(name) {
                    val html = rewriter.rewrite(fixture(name), url, loaderFor(sheets)).html
                    SCRIPT_TAG.containsMatchIn(html) shouldBe false
                    EVENT_HANDLER.containsMatchIn(html) shouldBe false
                    html shouldNotContain "javascript:"
                    html shouldNotContain "vbscript:"
                    html shouldNotContain "Content-Security-Policy"
                }
            }
        }

        test("numbers every element under body depth-first from 1, and only those elements") {
            val cloned = rewriter.rewrite(fixture("docs.html"), DOCS_URL, loaderFor(docsStylesheets))
            val document = Jsoup.parse(cloned.html, DOCS_URL)

            val ids = document.select("[data-vm-id]").map { it.attr("data-vm-id") }
            ids shouldContainExactly (1..cloned.elementCount).map { "vm-$it" }

            // Document order, not selector order.
            document.selectFirst("nav.toc")?.attr("data-vm-id") shouldBe "vm-1"
            document.selectFirst("nav.toc > a")?.attr("data-vm-id") shouldBe "vm-2"

            // Nothing in head, nothing on body itself, nothing that cannot carry an animation.
            document.head().select("[data-vm-id]").size shouldBe 0
            document.body().hasAttr("data-vm-id") shouldBe false
            document.select("br[data-vm-id], wbr[data-vm-id], style[data-vm-id]").size shouldBe 0
        }

        test("an svg root is addressable but its internals are not, and templates stay inert") {
            val document = rewrittenDocument(rewriter, "docs.html", DOCS_URL, docsStylesheets)

            document.selectFirst("svg").shouldNotBeNull().hasAttr("data-vm-id") shouldBe true
            document.select("svg [data-vm-id]").size shouldBe 0
            document.selectFirst("template").shouldNotBeNull().hasAttr("data-vm-id") shouldBe true
            document.select("template [data-vm-id]").size shouldBe 0
            // An SVG paint reference is a same-document fragment; making it absolute breaks it.
            document.selectFirst("circle")?.attr("fill") shouldBe "url(#g)"
        }

        test("absolutises every URL-bearing attribute against the page, honouring base href") {
            val document = rewrittenDocument(rewriter, "docs.html", DOCS_URL, docsStylesheets)

            document.selectFirst("nav.toc > a")?.attr("href") shouldBe "https://docs.example.org/guide/intro.html"
            document.selectFirst("a[href\$=terms.html]")?.attr("href") shouldBe "https://docs.example.org/legal/terms.html"
            document.selectFirst("img[alt=Diagram]")?.attr("src") shouldBe "https://docs.example.org/guide/img/diagram.png"
            document.selectFirst("img[alt=Diagram]")?.attr("srcset") shouldBe
                "https://docs.example.org/guide/img/diagram.png 1x, https://docs.example.org/guide/img/diagram@2x.png 2x"
            document.selectFirst("source")?.attr("srcset") shouldBe
                "https://docs.example.org/guide/img/diagram.webp 1x, https://docs.example.org/guide/img/diagram@2x.webp 2x"
            // The <base> itself is gone, so nothing can re-point what survived.
            document.select("base").size shouldBe 0
        }

        test("marketing page: relative URLs, srcset, poster and inline styles all become absolute") {
            val document = rewrittenDocument(rewriter, "marketing.html", MARKETING_URL, marketingStylesheets)

            document.selectFirst("a[href\$='/docs/']")?.attr("href") shouldBe "https://www.northwind.example/docs/"
            document.selectFirst("video")?.attr("poster") shouldBe "https://www.northwind.example/marketing/img/poster.jpg"
            document.selectFirst("section.hero")?.attr("style") shouldContain
                """url("https://www.northwind.example/marketing/hero-bg.png")"""
            document.selectFirst("img[alt=Screenshot]")?.attr("srcset") shouldBe
                "https://www.northwind.example/marketing/img/screenshot.png 1x, " +
                "https://www.northwind.example/marketing/img/screenshot@2x.png 2x"
            // Fragment and mailto links are left exactly as the page wrote them.
            document.selectFirst("a[href=#features]")?.attr("href") shouldBe "#features"
            document.selectFirst("a[href^=mailto]")?.attr("href") shouldBe "mailto:hello@northwind.example"
        }

        test("inlines stylesheets, keeps media queries, and resolves their URLs against the sheet") {
            val document = rewrittenDocument(rewriter, "docs.html", DOCS_URL, docsStylesheets)

            val inlined = document.selectFirst("style[data-vm-source]").shouldNotBeNull()
            inlined.attr("data-vm-source") shouldBe "https://docs.example.org/guide/assets/site.css"
            val css = inlined.data()

            // Relative to the stylesheet, not to the page.
            css shouldContain """url("https://docs.example.org/guide/img/paper.png")"""
            css shouldContain """url("https://docs.example.org/guide/assets/img/card.svg")"""
            // data: and already-absolute URLs are left alone.
            css shouldContain "url(data:image/gif;base64,R0lGODlhAQABAAAAACw=)"
            css shouldContain """url("https://cdn.example.net/texture.png")"""

            // One level of @import is inlined, wrapped in its media query.
            css shouldContain "@media screen {"
            css shouldContain """font-family: "Northwind""""
            css shouldContain """url("https://docs.example.org/guide/assets/fonts/northwind.woff2")"""
            // The inlined sheet's own import is absolutised and left for the browser.
            css shouldContain """@import url("https://docs.example.org/guide/assets/fonts/base.css")"""
            // An import we could not fetch stays an import, absolutised.
            css shouldContain """@import "https://docs.example.org/guide/assets/print.css""""
        }

        test("a stylesheet that cannot be fetched keeps its link, absolutised") {
            val document = rewrittenDocument(rewriter, "marketing.html", MARKETING_URL, marketingStylesheets)

            document.selectFirst("link[href='https://cdn.example.net/gone.css']").shouldNotBeNull()
            // A fetched sheet with a media attribute is wrapped rather than applied unconditionally.
            document.selectFirst("style[data-vm-source\$='print.css']")?.data() shouldContain "@media print {"
            // `rel="alternate stylesheet"` is off by default in a browser; inlining it would turn it on.
            document.selectFirst("link[href\$='high-contrast.css']").shouldNotBeNull()
        }

        test("drops preload-family links and keeps ordinary ones") {
            val document = rewrittenDocument(rewriter, "marketing.html", MARKETING_URL, marketingStylesheets)

            document.select("link[rel=preconnect], link[rel=dns-prefetch], link[rel=preload], link[rel=manifest]").size shouldBe 0
            document.selectFirst("link[rel=icon]")?.attr("href") shouldBe "https://www.northwind.example/favicon.ico"
        }

        test("hostile page: everything executable or navigable away is removed or defused") {
            val document = rewrittenDocument(rewriter, "hostile.html", HOSTILE_URL, emptyMap())

            document.select("iframe, object, embed, applet, script, base").size shouldBe 0
            document.select("meta[http-equiv=refresh]").size shouldBe 0

            document.select("a").forEach { anchor ->
                withClue(anchor.text()) {
                    val href = anchor.attr("href").lowercase()
                    href.startsWith("javascript:") shouldBe false
                    href.startsWith("vbscript:") shouldBe false
                    href.startsWith("data:text/html") shouldBe false
                }
            }
            document.selectFirst("a:contains(mixed case)")?.attr("href") shouldBe "#"
            document.selectFirst("a:contains(tab escaped)")?.attr("href") shouldBe "#"
            document.selectFirst("button")?.attr("formaction") shouldBe "#"
            document.selectFirst("use")?.attr("xlink:href") shouldBe "#"
            document.selectFirst("div[style]")?.attr("style") shouldContain """url("#")"""
        }

        test("hostile page: nothing survives that would come back to life in an export") {
            // Phase 7 hands `base_html` to a designer's own site, where there is no CSP behind it.
            val document = rewrittenDocument(rewriter, "hostile.html", HOSTILE_URL, emptyMap())

            // `ping` is a POST to a third party on every click.
            document.select("[ping]").size shouldBe 0
            document.selectFirst("a[href\$='/ok2']").shouldNotBeNull()
            document.selectFirst("area").shouldNotBeNull().attr("href") shouldBe "https://hostile.example/ok3"

            // SMIL retargets links after everything here has run, which makes it scripting.
            document.select("animate, set, animatemotion").size shouldBe 0
            // …but an animation that only moves pixels is the kind of thing this tool is for.
            document.selectFirst("animatetransform").shouldNotBeNull().attr("type") shouldBe "rotate"

            // Scheme neutralisation reaches inside SVG, not just HTML elements.
            document.selectFirst("svg#smil a")?.attr("href") shouldBe "#"
            document.selectFirst("image")?.attr("xlink:href") shouldBe "#"
        }

        test("keeps forms but disarms them") {
            val form = rewrittenDocument(rewriter, "hostile.html", HOSTILE_URL, emptyMap()).selectFirst("form")

            form.shouldNotBeNull()
            form.attr("action") shouldBe "#"
            form.hasAttr("target") shouldBe false
            form.selectFirst("input").shouldNotBeNull()
        }

        test("takes the data-vm- namespace back from the source page") {
            val document = rewrittenDocument(rewriter, "hostile.html", HOSTILE_URL, emptyMap())

            document.body().hasAttr("data-vm-id") shouldBe false
            document.body().hasAttr("data-vm-note") shouldBe false
            // The anchor that arrived claiming vm-1 gets whatever its position says it is.
            document.selectFirst("a[href\$='/ok']")?.attr("data-vm-id") shouldNotBe "vm-1"
        }

        test("promotes noscript content, because that is the page without its scripts") {
            val document = rewrittenDocument(rewriter, "hostile.html", HOSTILE_URL, emptyMap())

            document.select("noscript").size shouldBe 0
            val fallback = document.selectFirst("p.fallback").shouldNotBeNull()
            fallback.text() shouldBe "JavaScript is off"
            fallback.hasAttr("data-vm-id") shouldBe true
        }

        test("declares utf-8 first in head and drops the source's charset declarations") {
            val document = rewrittenDocument(rewriter, "hostile.html", HOSTILE_URL, emptyMap())

            val headChildren = document.head().children()
            val first = headChildren.first().shouldNotBeNull()
            first.normalName() shouldBe "meta"
            first.attr("charset") shouldBe "utf-8"
            document.select("meta[charset]").size shouldBe 1
            document.html() shouldNotContain "windows-1252"
        }

        test("a stylesheet that contains the characters that close a style element cannot escape it") {
            val hostileCss = """body::after { content: "</style><script>alert(1)</script>" }"""
            val html = """<html><head><link rel="stylesheet" href="/x.css"></head><body><p>hi</p></body></html>"""

            val cloned =
                rewriter.rewrite(html, "https://example.com/", loaderFor(mapOf("https://example.com/x.css" to hostileCss)))

            // The characters survive as CSS text, but escaped, so re-parsing the stored document
            // yields no script element and the rest of the sheet does not become markup.
            cloned.html shouldContain """<\/style"""
            val reparsed = Jsoup.parse(cloned.html)
            reparsed.select("script").size shouldBe 0
            reparsed.selectFirst("style[data-vm-source]").shouldNotBeNull().data() shouldContain "body::after"
        }

        test("stops fetching stylesheets once the count budget is spent") {
            val links = (1..40).joinToString("") { """<link rel="stylesheet" href="/s$it.css">""" }
            val sheets = (1..40).associate { "https://example.com/s$it.css" to ".s$it { color: red }" }
            val requested = mutableListOf<String>()
            val counting: StylesheetLoader = { url ->
                requested += url
                fetchOf(sheets, url)
            }

            val html = "<html><head>$links</head><body><p>x</p></body></html>"
            val document = Jsoup.parse(HtmlRewriter().rewrite(html, "https://example.com/", counting).html)

            requested.size shouldBe HtmlRewriter.DEFAULT_MAX_STYLESHEETS
            document.select("style[data-vm-source]").size shouldBe HtmlRewriter.DEFAULT_MAX_STYLESHEETS
            document.select("link[rel=stylesheet]").size shouldBe 40 - HtmlRewriter.DEFAULT_MAX_STYLESHEETS
        }

        test("a stylesheet bigger than the remaining byte budget keeps its link") {
            val big = "a".repeat(2048)
            val html = """<html><head><link rel="stylesheet" href="/big.css"></head><body><p>x</p></body></html>"""

            val cloned =
                HtmlRewriter(maxStylesheets = 5, maxCssBytes = 1024).rewrite(
                    html,
                    "https://example.com/",
                    loaderFor(mapOf("https://example.com/big.css" to big)),
                )

            Jsoup.parse(cloned.html).select("style[data-vm-source]").size shouldBe 0
            Jsoup.parse(cloned.html).select("link[rel=stylesheet]").size shouldBe 1
        }

        test("a stylesheet of unterminated @import rules is rewritten in well under a second") {
            // `@import "a" ` with no semicolon: every match attempt used to scan to end of input,
            // so 512 KB of it cost half a minute of uninterruptible CPU per sheet.
            val hostile = """@import "a" """.repeat(HOSTILE_SHEET_BYTES / 12)
            hostile.length shouldBeGreaterThan 500_000

            val elapsed =
                measureTimeMillis {
                    rewriter.rewrite(linkTo("/hostile.css"), EXAMPLE_URL, loaderFor(mapOf(EXAMPLE_SHEET to hostile)))
                }

            withClue("took ${elapsed}ms") { elapsed shouldBeLessThan 1_000L }
        }

        test("a stylesheet of unterminated url( tokens is rewritten in well under a second") {
            val hostile = "url(".repeat(HOSTILE_SHEET_BYTES / 4)

            val elapsed =
                measureTimeMillis {
                    rewriter.rewrite(linkTo("/hostile.css"), EXAMPLE_URL, loaderFor(mapOf(EXAMPLE_SHEET to hostile)))
                }

            withClue("took ${elapsed}ms") { elapsed shouldBeLessThan 1_000L }
        }

        test("a long whitespace run inside url( costs milliseconds, in a style block and in a sheet") {
            // `url(\s*…\s*` with an atom between that can match empty is an ambiguous split of the
            // run: quadratic. 200 000 spaces used to cost ~160 s in the dangerous-url sweep alone.
            val run = " ".repeat(200_000)
            val styleBlock = "<html><head><style>a{background:url($run)}</style></head><body><p>x</p></body></html>"
            val importSheet = "@import url($run"

            val elapsed =
                measureTimeMillis {
                    rewriter.rewrite(styleBlock, EXAMPLE_URL, loaderFor(emptyMap()))
                    rewriter.rewrite(linkTo("/hostile.css"), EXAMPLE_URL, loaderFor(mapOf(EXAMPLE_SHEET to importSheet)))
                }

            withClue("took ${elapsed}ms") { elapsed shouldBeLessThan 1_000L }
        }

        test("whitespace around a url( token is still tolerated after the possessive fix") {
            val rules = """a{background:url(  "img/a.png"  )} b{background:url(\t img/b.png )}""".replace("\\t", "\t")
            val html = "<html><head><style>$rules</style></head><body></body></html>"
            val rewritten = rewriter.rewrite(html, EXAMPLE_URL, loaderFor(emptyMap())).html
            val css =
                Jsoup
                    .parse(rewritten)
                    .select("style")
                    .first()
                    ?.data()
                    .orEmpty()
            css shouldContain """url("https://example.com/img/a.png")"""
            css shouldContain """url("https://example.com/img/b.png")"""
            val defused = """<html><head><style>a{background:url(   javascript:alert(1))}</style></head><body></body></html>"""
            rewriter.rewrite(defused, EXAMPLE_URL, loaderFor(emptyMap())).html shouldNotContain "javascript:"
        }

        test("regex work over fetched CSS is inside the clone deadline, whatever the pattern shape") {
            // The between-stage checks number a few dozen. A deadline that only starts throwing after
            // 200 checks can therefore only fire from INSIDE the regex engine's reads of the input.
            var checks = 0
            val lateDeadline =
                DeadlineCheck {
                    checks++
                    if (checks > 200) throw CloneException.Unreachable("clone timed out")
                }
            val bigSheet = "a{background:url(img/x.png)}\n".repeat(60_000)
            val html = "<html><head><style>$bigSheet</style></head><body></body></html>"

            shouldThrow<CloneException.Unreachable> {
                rewriter.rewrite(html, EXAMPLE_URL, loaderFor(emptyMap()), lateDeadline)
            }
        }

        test("strips comment nodes, so nothing downstream can be swallowed by one") {
            val html =
                """
                <!-- <head> --><html><head><!--[if lt IE 9]><script src="/ie.js"></script><![endif]-->
                <title>Commented</title></head><body><p>keep me</p><!-- </body --></body></html><!-- trailing -->
                """.trimIndent()

            val cloned = rewriter.rewrite(html, EXAMPLE_URL, loaderFor(emptyMap()))

            cloned.html shouldNotContain "<!--"
            cloned.html shouldNotContain "-->"
            // A conditional comment's contents go with it rather than being promoted.
            cloned.html shouldNotContain "ie.js"
            cloned.html shouldContain "keep me"
            cloned.title shouldBe "Commented"
        }

        test("stops between stages once the clone's deadline has passed") {
            var remaining = 2
            val expiring = DeadlineCheck { if (remaining-- <= 0) throw CloneException.Unreachable("clone timed out") }

            val error =
                shouldThrow<CloneException.Unreachable> {
                    rewriter.rewrite(fixture("docs.html"), DOCS_URL, loaderFor(docsStylesheets), expiring)
                }

            error.message.orEmpty() shouldContain "clone timed out"
        }

        test("drops a stylesheet link whose URL was refused, and keeps one that merely failed") {
            val html =
                """
                <html><head>
                  <link rel="stylesheet" href="https://internal.example/theme.css">
                  <link rel="stylesheet" href="https://cdn.example/gone.css">
                </head><body><p>x</p></body></html>
                """.trimIndent()
            val loader: StylesheetLoader = { url ->
                if (url.contains("internal")) StylesheetFetch.Blocked else StylesheetFetch.Unavailable
            }

            val document = Jsoup.parse(rewriter.rewrite(html, EXAMPLE_URL, loader).html)

            document.select("link[href*=internal]").size shouldBe 0
            document.selectFirst("link[rel=stylesheet]")?.attr("href") shouldBe "https://cdn.example/gone.css"
        }

        test("counts every stylesheet attempt against the budget, not only the ones that load") {
            val links = (1..100).joinToString("") { """<link rel="stylesheet" href="/gone$it.css">""" }
            val requested = mutableListOf<String>()
            val allMissing: StylesheetLoader = { url ->
                requested += url
                StylesheetFetch.Unavailable
            }

            HtmlRewriter().rewrite("<html><head>$links</head><body><p>x</p></body></html>", EXAMPLE_URL, allMissing)

            requested.size shouldBe HtmlRewriter.DEFAULT_MAX_STYLESHEETS
        }

        test("falls back to the host when the page has no usable title") {
            val html = "<html><head><title>   </title></head><body><p>x</p></body></html>"

            rewriter.rewrite(html, DOCS_URL, loaderFor(emptyMap())).title shouldBe "docs.example.org"
        }

        test("counts exactly the elements it numbered, and reports the URL it was given") {
            val cloned = rewriter.rewrite(fixture("hostile.html"), HOSTILE_URL, loaderFor(emptyMap()))

            Jsoup.parse(cloned.html).select("[data-vm-id]").size shouldBe cloned.elementCount
            cloned.finalUrl shouldBe HOSTILE_URL
        }
    })

private fun rewrittenDocument(
    rewriter: HtmlRewriter,
    fixtureName: String,
    url: String,
    sheets: Map<String, String>,
): Document = Jsoup.parse(rewriter.rewrite(fixture(fixtureName), url, loaderFor(sheets)).html, url)

private fun loaderFor(sheets: Map<String, String>): StylesheetLoader = { url -> fetchOf(sheets, url) }

private fun fetchOf(
    sheets: Map<String, String>,
    url: String,
): StylesheetFetch = sheets[url]?.let { StylesheetFetch.Loaded(LoadedStylesheet(url, it)) } ?: StylesheetFetch.Unavailable

private fun fixture(name: String): String = Files.readString(Path.of("src/test/resources/clone", name))

/**
 * Golden comparison. Regenerate deliberately with
 * `VM_UPDATE_GOLDEN=1 ./gradlew test --tests '*HtmlRewriterTest*'`, then read the diff: a change
 * here is a change to every page cloned from now on.
 */
private fun assertGolden(
    name: String,
    actual: String,
) {
    val path = Path.of("src/test/resources/clone/expected", name)
    if (System.getenv("VM_UPDATE_GOLDEN") == "1") {
        Files.createDirectories(path.parent)
        Files.writeString(path, actual)
    }
    actual shouldBe Files.readString(path)
}
