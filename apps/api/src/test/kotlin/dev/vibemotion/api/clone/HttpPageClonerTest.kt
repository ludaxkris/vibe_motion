package dev.vibemotion.api.clone

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import org.jsoup.Jsoup

class HttpPageClonerTest :
    FunSpec({

        val server = FixtureServer()
        afterSpec { server.close() }

        fun cloner(
            maxBytes: Long = 1_000_000,
            timeoutMs: Long = 5_000,
        ): HttpPageCloner =
            HttpPageCloner(
                PageFetcher(
                    guard = SsrfGuard(HostResolver.SYSTEM, allowLoopbackForTests = true),
                    maxDocumentBytes = maxBytes,
                    timeoutMs = timeoutMs,
                ),
            )

        server.serveText(
            "/page.html",
            """
            <!doctype html>
            <html><head>
              <title>Fixture page</title>
              <link rel="stylesheet" href="theme.css">
              <link rel="stylesheet" href="missing.css">
            </head><body>
              <h1 onclick="boom()">Fixture</h1>
              <script>alert(1)</script>
              <p><a href="deeper/page.html">deeper</a></p>
              <img src="img/pic.png" alt="pic">
            </body></html>
            """.trimIndent(),
        )
        server.serveText("/theme.css", "body { background: url(img/bg.png) }", contentType = "text/css")
        server.status("/missing.css", 404)
        server.serveText("/not-html.json", """{"a":1}""", contentType = "application/json")
        server.redirect("/moved.html", "/page.html")

        test("clones a real page end to end") {
            val cloned = cloner().clone(server.url("/page.html"))

            cloned.title shouldBe "Fixture page"
            cloned.finalUrl shouldBe server.url("/page.html")
            cloned.elementCount shouldBeGreaterThan 3

            val document = Jsoup.parse(cloned.html)
            cloned.html shouldNotContain "<script"
            cloned.html shouldNotContain "onclick"
            document.selectFirst("a")?.attr("href") shouldBe server.url("/deeper/page.html")
            document.selectFirst("img")?.attr("src") shouldBe server.url("/img/pic.png")
            document.selectFirst("h1")?.attr("data-vm-id") shouldBe "vm-1"
        }

        test("inlines what it can and leaves the rest linked, rather than failing") {
            val document = Jsoup.parse(cloner().clone(server.url("/page.html")).html)

            val inlined = document.selectFirst("style[data-vm-source]")
            inlined?.attr("data-vm-source") shouldBe server.url("/theme.css")
            inlined?.data() shouldContain """url("${server.url("/img/bg.png")}")"""

            document.selectFirst("link[rel=stylesheet]")?.attr("href") shouldBe server.url("/missing.css")
        }

        test("resolves relative URLs against where the page finally came from") {
            val cloned = cloner().clone(server.url("/moved.html"))

            cloned.finalUrl shouldBe server.url("/page.html")
            Jsoup.parse(cloned.html).selectFirst("a")?.attr("href") shouldBe server.url("/deeper/page.html")
        }

        test("surfaces each fetch failure as the CloneException the routes map to a status") {
            shouldThrow<CloneException.NotHtml> { cloner().clone(server.url("/not-html.json")) }
            shouldThrow<CloneException.Blocked> { cloner().clone("http://169.254.169.254/latest/meta-data/") }
            shouldThrow<CloneException.InvalidUrl> { cloner().clone("not a url at all") }
            shouldThrow<CloneException.InvalidUrl> { cloner().clone("file:///etc/passwd") }
            shouldThrow<CloneException.TooLarge> { cloner(maxBytes = 64).clone(server.url("/page.html")) }
        }

        test("the production wiring refuses loopback, and names no internal address doing it") {
            // Not the test cloner: this is the guard exactly as `HttpPageCloner.create` builds it.
            val production = HttpPageCloner(PageFetcher(SsrfGuard(), 1_000_000, 5_000))

            val error = shouldThrow<CloneException.Blocked> { production.clone("http://2130706433/") }

            error.message.orEmpty() shouldNotContain "127.0.0.1"
            error.code shouldBe "url_blocked"
            shouldThrow<CloneException.Blocked> { production.clone(server.url("/page.html")) }
        }
    })
