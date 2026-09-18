package dev.vibemotion.api.clone

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.comparables.shouldBeLessThan
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.types.shouldBeInstanceOf
import kotlinx.coroutines.delay
import java.net.http.HttpClient
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util.concurrent.atomic.AtomicReference

class PageFetcherTest :
    FunSpec({

        val server = FixtureServer()
        afterSpec { server.close() }

        val client =
            HttpClient
                .newBuilder()
                .followRedirects(HttpClient.Redirect.NEVER)
                .connectTimeout(Duration.ofSeconds(2))
                .version(HttpClient.Version.HTTP_1_1)
                .proxy(HttpClient.Builder.NO_PROXY)
                .build()

        fun fetcher(
            maxBytes: Long = 1_000_000,
            timeoutMs: Long = 5_000,
        ): PageFetcher =
            PageFetcher(
                guard = SsrfGuard(HostResolver.SYSTEM, allowLoopbackForTests = true),
                maxDocumentBytes = maxBytes,
                timeoutMs = timeoutMs,
                client = client,
                nanoTime = System::nanoTime,
            )

        server.serveText("/plain", "<!doctype html><html><body><h1>Hello</h1></body></html>")

        // Three hops is the limit; four is one too many.
        server.redirect("/hop-1", "/hop-2")
        server.redirect("/hop-2", server.url("/hop-3"))
        server.redirect("/hop-3", "/plain", status = 301)
        server.redirect("/far-0", "/far-1")
        server.redirect("/far-1", "/far-2")
        server.redirect("/far-2", "/far-3")
        server.redirect("/far-3", "/plain")

        server.redirect("/to-metadata", "http://169.254.169.254/latest/meta-data/")
        server.redirect("/to-nowhere", "data:text/html,<html></html>")
        server.on("/no-location") { exchange -> exchange.sendResponseHeaders(302, -1) }
        server.status("/gone", 404)
        server.status("/broken", 500)

        test("follows a redirect chain and reports where the content really came from") {
            val page = fetcher().fetchDocument(server.url("/hop-1"))

            page.finalUrl shouldBe server.url("/plain")
            page.html shouldContain "<h1>Hello</h1>"
        }

        test("gives up after more than three redirects") {
            val error = shouldThrow<CloneException.Unreachable> { fetcher().fetchDocument(server.url("/far-0")) }
            error.message.orEmpty() shouldContain "redirected more than 3 times"
        }

        test("re-applies the guard on every hop, so a redirect cannot reach the metadata endpoint") {
            val error = shouldThrow<CloneException.Blocked> { fetcher().fetchDocument(server.url("/to-metadata")) }
            error.message.orEmpty() shouldContain "link-local"
        }

        test("refuses a redirect to something that is not a fetchable URL") {
            shouldThrow<CloneException> { fetcher().fetchDocument(server.url("/to-nowhere")) }
        }

        test("treats a redirect without a Location as unreachable") {
            shouldThrow<CloneException.Unreachable> { fetcher().fetchDocument(server.url("/no-location")) }
        }

        test("maps a non-2xx status to Unreachable") {
            shouldThrow<CloneException.Unreachable> { fetcher().fetchDocument(server.url("/gone")) }
                .message
                .orEmpty() shouldContain "HTTP 404"
            shouldThrow<CloneException.Unreachable> { fetcher().fetchDocument(server.url("/broken")) }
        }

        test("refuses a body that announces more than the cap before reading a byte") {
            server.serve("/announced-big", ByteArray(4096) { 'x'.code.toByte() }, "text/html")

            val error =
                shouldThrow<CloneException.TooLarge> {
                    fetcher(maxBytes = 1024).fetchDocument(server.url("/announced-big"))
                }
            error.message.orEmpty() shouldContain "announced 4096 bytes"
        }

        test("abandons a streamed body the moment it passes the cap") {
            server.serveChunked("/stream-big", ByteArray(8192) { 'y'.code.toByte() }, times = 64)

            shouldThrow<CloneException.TooLarge> {
                fetcher(maxBytes = 1024).fetchDocument(server.url("/stream-big"))
            }
        }

        test("counts gzip against the cap after decompression, so a bomb costs a buffer") {
            val bomb = FixtureServer.gzip(ByteArray(8 * 1024 * 1024) { 'a'.code.toByte() })
            bomb.size shouldBeLessThan 100_000
            server.serve("/bomb", bomb, "text/html", mapOf("Content-Encoding" to "gzip"))

            shouldThrow<CloneException.TooLarge> { fetcher(maxBytes = 64 * 1024).fetchDocument(server.url("/bomb")) }
        }

        test("decodes an ordinary gzip response") {
            val html = "<!doctype html><html><body><p>compressed</p></body></html>"
            server.serve("/gzipped", FixtureServer.gzip(html.toByteArray()), "text/html", mapOf("Content-Encoding" to "gzip"))

            fetcher().fetchDocument(server.url("/gzipped")).html shouldContain "compressed"
        }

        test("refuses a document that is not HTML") {
            server.serveText("/data.json", """{"not":"html"}""", contentType = "application/json")

            val error = shouldThrow<CloneException.NotHtml> { fetcher().fetchDocument(server.url("/data.json")) }
            error.message.orEmpty() shouldContain "application/json"
        }

        test("sniffs for HTML when the server announces no content type") {
            server.serveText("/untyped-html", "<!DOCTYPE html><html><body>ok</body></html>", contentType = null)
            server.serveText("/untyped-text", "just some words, no markup at all", contentType = null)

            fetcher().fetchDocument(server.url("/untyped-html")).html shouldContain "ok"
            shouldThrow<CloneException.NotHtml> { fetcher().fetchDocument(server.url("/untyped-text")) }
        }

        test("accepts application/xhtml+xml") {
            server.serveText("/xhtml", "<html><body>xhtml</body></html>", contentType = "application/xhtml+xml")

            fetcher().fetchDocument(server.url("/xhtml")).html shouldContain "xhtml"
        }

        test("decodes using the charset from the content type") {
            val latin1 = "<html><body>café</body></html>".toByteArray(StandardCharsets.ISO_8859_1)
            server.serve("/latin1", latin1, "text/html; charset=ISO-8859-1")

            fetcher().fetchDocument(server.url("/latin1")).html shouldContain "café"
        }

        test("falls back to the meta charset, then to UTF-8") {
            val metaDeclared = "<html><head><meta charset=\"iso-8859-1\"></head><body>café</body></html>"
            server.serve("/meta-charset", metaDeclared.toByteArray(StandardCharsets.ISO_8859_1), "text/html")
            server.serve("/utf8-default", "<html><body>café</body></html>".toByteArray(Charsets.UTF_8), "text/html")

            fetcher().fetchDocument(server.url("/meta-charset")).html shouldContain "café"
            fetcher().fetchDocument(server.url("/utf8-default")).html shouldContain "café"
        }

        test("times out on a slow server") {
            server.slow("/slow", delayMillis = 2_000)

            shouldThrow<CloneException.Unreachable> { fetcher(timeoutMs = 300).fetchDocument(server.url("/slow")) }
        }

        test("gives up on a body that stalls after the headers, and frees the reader thread") {
            server.stallAfterHeaders("/stalled-document")

            val failure = AtomicReference<Throwable>()
            val reader =
                Thread({
                    runCatching { fetcher(timeoutMs = 300).fetchDocument(server.url("/stalled-document")) }
                        .onFailure(failure::set)
                }, "stalled-document-reader").apply { isDaemon = true }

            reader.start()
            reader.join(2_000)

            withClue("the reader thread must not still be parked inside read()") {
                reader.isAlive shouldBe false
            }
            val error = failure.get().shouldBeInstanceOf<CloneException.Unreachable>()
            error.message.orEmpty() shouldContain "300ms"
        }

        test("a stalled stylesheet body is bounded by the same deadline") {
            server.stallAfterHeaders("/stalled.css", prefix = "body{", contentType = "text/css")

            val failure = AtomicReference<Throwable>()
            val reader =
                Thread({
                    runCatching { fetcher(timeoutMs = 300).fetchStylesheet(server.url("/stalled.css")) }
                        .onFailure(failure::set)
                }, "stalled-stylesheet-reader").apply { isDaemon = true }

            reader.start()
            reader.join(2_000)

            reader.isAlive shouldBe false
            failure.get().shouldBeInstanceOf<CloneException.Unreachable>()
        }

        test("spends one deadline across every hop, not one per hop") {
            server.on("/creep-0") { exchange ->
                Thread.sleep(250)
                exchange.responseHeaders.set("Location", "/creep-1")
                exchange.sendResponseHeaders(302, -1)
            }
            server.on("/creep-1") { exchange ->
                Thread.sleep(250)
                exchange.responseHeaders.set("Location", "/plain")
                exchange.sendResponseHeaders(302, -1)
            }

            // Each hop alone is comfortably inside the budget; the three together are not.
            shouldThrow<CloneException.Unreachable> { fetcher(timeoutMs = 400).fetchDocument(server.url("/creep-0")) }
        }

        test("hands out a deadline check that fires once the clone's budget is spent") {
            val spent = fetcher(timeoutMs = 1)
            val deadline = spent.newDeadline()
            delay(50)

            shouldThrow<CloneException.Unreachable> { spent.deadlineCheck(deadline).check() }
                .message
                .orEmpty() shouldContain "clone timed out"

            // And says nothing while there is budget left.
            val fresh = fetcher(timeoutMs = 10_000)
            fresh.deadlineCheck(fresh.newDeadline()).check()
        }

        test("fetches a stylesheet and reports where it ended up") {
            server.serveText("/theme.css", "body { color: red }", contentType = "text/css")
            server.redirect("/old-theme.css", "/theme.css")

            val sheet = fetcher().fetchStylesheet(server.url("/old-theme.css"))

            sheet.url shouldBe server.url("/theme.css")
            sheet.css shouldBe "body { color: red }"
        }

        test("refuses a stylesheet that is not CSS, and one over the per-sheet cap") {
            server.serveText("/not.css", "<html></html>", contentType = "text/html")
            server.serve("/huge.css", ByteArray(PageFetcher.MAX_STYLESHEET_BYTES.toInt() + 1) { 'z'.code.toByte() }, "text/css")

            shouldThrow<CloneException.NotHtml> { fetcher().fetchStylesheet(server.url("/not.css")) }
                .message
                .orEmpty() shouldContain "text/css"
            shouldThrow<CloneException.TooLarge> { fetcher().fetchStylesheet(server.url("/huge.css")) }
        }

        test("still refuses a blocked URL before opening a socket") {
            shouldThrow<CloneException.Blocked> { fetcher().fetchDocument("http://169.254.169.254/latest/meta-data/") }
            shouldThrow<CloneException.InvalidUrl> { fetcher().fetchDocument("file:///etc/passwd") }
        }
    })
