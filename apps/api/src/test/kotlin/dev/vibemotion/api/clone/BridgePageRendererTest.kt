package dev.vibemotion.api.clone

import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.comparables.shouldBeLessThan
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import org.jsoup.Jsoup
import kotlin.system.measureTimeMillis

private const val WEB_ORIGIN = "https://app.vibemotion.dev"
private val NO_STYLESHEETS: StylesheetLoader = { StylesheetFetch.Unavailable }

class BridgePageRendererTest :
    FunSpec({

        val renderer = BridgePageRenderer(WEB_ORIGIN)
        val page =
            """
            <!doctype html><html lang="en"><head><meta charset="utf-8"><title>Clone</title></head>
            <body><h1 data-vm-id="vm-1">Hi</h1></body></html>
            """.trimIndent()

        test("puts the CSP meta first in head and the bridge last in body") {
            val rendered = renderer.render(page)
            val document = Jsoup.parse(rendered.html)

            val firstInHead = document.head().children().first()
            firstInHead?.normalName() shouldBe "meta"
            firstInHead?.attr("http-equiv") shouldBe "Content-Security-Policy"

            val lastInBody = document.body().children().last()
            lastInBody?.normalName() shouldBe "script"
            lastInBody?.attr("src") shouldBe BridgeAssets.BRIDGE_PATH
            lastInBody?.attr("data-vm-parent-origin") shouldBe WEB_ORIGIN
            lastInBody?.hasAttr("defer") shouldBe true
        }

        test("frame-ancestors is in the header policy only, because meta ignores it") {
            val rendered = renderer.render(page)

            rendered.contentSecurityPolicy shouldContain "frame-ancestors $WEB_ORIGIN"
            rendered.html shouldNotContain "frame-ancestors"

            val metaTag = Jsoup.parse(rendered.html).selectFirst("meta[http-equiv]")
            val meta = metaTag?.attr("content").orEmpty()
            rendered.contentSecurityPolicy shouldBe "$meta; frame-ancestors $WEB_ORIGIN"
        }

        test("the policy admits the bridge and nothing else executable") {
            val policy = renderer.render(page).contentSecurityPolicy

            listOf(
                "default-src 'none'",
                "script-src 'self'",
                "style-src 'unsafe-inline' https: http:",
                "img-src * data: blob:",
                "font-src * data:",
                "media-src * data: blob:",
                "connect-src 'none'",
                "frame-src 'none'",
                "object-src 'none'",
                "base-uri 'none'",
                "form-action 'none'",
            ).forEach { directive -> policy shouldContain directive }
        }

        test("never touches the stored document") {
            val before = page
            renderer.render(page)

            page shouldBe before
            renderer.render(page).html shouldBe renderer.render(page).html
        }

        test("escapes the origin it writes into an attribute") {
            val rendered = BridgePageRenderer("""https://evil"onload="alert(1)""").render(page)

            rendered.html shouldNotContain """"onload=""""
            rendered.html shouldContain "&quot;"
        }

        test("copes with a head that carries attributes, and with no head or body at all") {
            val withHeadAttributes = """<html><head profile="x"><title>t</title></head><body><p>p</p></body></html>"""
            Jsoup
                .parse(renderer.render(withHeadAttributes).html)
                .head()
                .children()
                .first()
                ?.attr("http-equiv") shouldBe "Content-Security-Policy"

            val bare = "<p>just a fragment</p>"
            val rendered = renderer.render(bare)
            rendered.html shouldContain "just a fragment"
            rendered.html shouldContain BridgeAssets.BRIDGE_PATH
        }

        test("does not mistake a header element for the head") {
            val headerFirst = "<html><body><header>nav</header></body></html>"

            val rendered = renderer.render(headerFirst)

            rendered.html shouldContain "<header>nav</header>"
            Jsoup.parse(rendered.html).select("script[src]").size shouldBe 1
        }

        test("the bridge is live when the source page ended in a comment that looks like </body>") {
            // The whole point of stripping comments at clone time: `lastIndexOf("</body")` used to
            // land inside the comment, leaving the bridge tag inert and the project mute forever.
            val source =
                "<!-- <head> --><html><head><title>t</title></head>" +
                    "<body><p>hi</p><!-- </body --></body></html><!-- </body> -->"
            val baseHtml = HtmlRewriter().rewrite(source, "https://example.com/", NO_STYLESHEETS).html

            val document = Jsoup.parse(renderer.render(baseHtml).html)

            document
                .body()
                .children()
                .last()
                ?.normalName() shouldBe "script"
            document.select("script[src]").size shouldBe 1
            document
                .head()
                .children()
                .first()
                ?.attr("http-equiv") shouldBe "Content-Security-Policy"
        }

        test("a comment cannot capture either insertion point, even in a row cloned before stripping") {
            val legacy =
                "<!-- <head> --><html><head><title>t</title></head>" +
                    "<body><p>hi</p><!-- </body --></body></html>"

            val document = Jsoup.parse(renderer.render(legacy).html)

            document
                .head()
                .children()
                .first()
                ?.attr("http-equiv") shouldBe "Content-Security-Policy"
            document
                .body()
                .children()
                .last()
                ?.normalName() shouldBe "script"
        }

        test("renders a megabyte in well under a frame") {
            val big =
                buildString {
                    append("<!doctype html><html><head><title>big</title></head><body>")
                    var index = 0
                    while (length < 1_000_000) {
                        append("<div data-vm-id=\"vm-${index++}\"><p>row $index</p></div>")
                    }
                    append("</body></html>")
                }
            big.length shouldBeGreaterThan 1_000_000

            repeat(20) { renderer.render(big) }
            val elapsed = measureTimeMillis { repeat(10) { renderer.render(big) } }

            (elapsed / 10.0) shouldBeLessThan 50.0
        }
    })
