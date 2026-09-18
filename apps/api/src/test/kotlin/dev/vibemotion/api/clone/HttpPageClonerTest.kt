package dev.vibemotion.api.clone

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import org.jsoup.Jsoup
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class HttpPageClonerTest :
    FunSpec({

        val server = FixtureServer()
        afterSpec { server.close() }

        fun cloner(
            maxBytes: Long = 1_000_000,
            timeoutMs: Long = 5_000,
            maxConcurrentClones: Int = HttpPageCloner.DEFAULT_MAX_CONCURRENT_CLONES,
            acquireTimeoutMs: Long = HttpPageCloner.DEFAULT_ACQUIRE_TIMEOUT_MS,
        ): HttpPageCloner =
            HttpPageCloner(
                PageFetcher(
                    guard = SsrfGuard(HostResolver.SYSTEM, allowLoopbackForTests = true),
                    maxDocumentBytes = maxBytes,
                    timeoutMs = timeoutMs,
                ),
                maxConcurrentClones = maxConcurrentClones,
                acquireTimeoutMs = acquireTimeoutMs,
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

        test("refuses a clone once the instance is at its concurrency limit, then recovers") {
            val started = CountDownLatch(1)
            val release = CountDownLatch(1)
            server.on("/held.html") { exchange ->
                started.countDown()
                release.await(10, TimeUnit.SECONDS)
                val bytes = "<html><head><title>Held</title></head><body><p>held</p></body></html>".toByteArray()
                exchange.responseHeaders.set("Content-Type", "text/html")
                exchange.sendResponseHeaders(200, bytes.size.toLong())
                exchange.responseBody.write(bytes)
            }

            val limited = cloner(maxConcurrentClones = 1, acquireTimeoutMs = 100)
            coroutineScope {
                val holding = async(Dispatchers.IO) { limited.clone(server.url("/held.html")) }
                started.await(10, TimeUnit.SECONDS) shouldBe true

                val busy = shouldThrow<CloneException.Busy> { limited.clone(server.url("/page.html")) }
                busy.code shouldBe "clone_busy"
                busy.retryAfterSeconds shouldBe 5

                release.countDown()
                holding.await().title shouldBe "Held"
            }

            // The permit came back: the next caller is served rather than told the server is busy.
            limited.clone(server.url("/page.html")).title shouldBe "Fixture page"
        }

        test("releases its permit when a clone fails, not only when one succeeds") {
            val limited = cloner(maxConcurrentClones = 1, acquireTimeoutMs = 100)

            shouldThrow<CloneException.NotHtml> { limited.clone(server.url("/not-html.json")) }
            shouldThrow<CloneException.Blocked> { limited.clone("http://169.254.169.254/latest/meta-data/") }

            limited.clone(server.url("/page.html")).title shouldBe "Fixture page"
        }

        test("drops a stylesheet link the guard refused, rather than leaving it for the export") {
            server.serveText(
                "/blocked-sheet.html",
                """
                <html><head>
                  <link rel="stylesheet" href="http://169.254.169.254/latest/meta-data/theme.css">
                  <link rel="stylesheet" href="missing.css">
                </head><body><p>x</p></body></html>
                """.trimIndent(),
            )

            val document = Jsoup.parse(cloner().clone(server.url("/blocked-sheet.html")).html)

            document.select("link[href*=169.254]").size shouldBe 0
            // One that merely 404s is a different thing: the browser may still be able to get it.
            document.selectFirst("link[rel=stylesheet]")?.attr("href") shouldBe server.url("/missing.css")
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
