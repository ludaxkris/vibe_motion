package dev.vibemotion.api.clone

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.zip.GZIPOutputStream

/**
 * A real HTTP server on loopback, so the fetcher is exercised over a socket rather than against a
 * mocked `HttpClient`: redirects, chunked bodies, content encodings and timeouts are all things the
 * JDK client does, and a fake would only prove that the fake agrees with itself.
 */
internal class FixtureServer : AutoCloseable {
    private val server: HttpServer = HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0)
    private val executor: ExecutorService = Executors.newCachedThreadPool()

    init {
        server.executor = executor
        server.start()
    }

    /** Always the literal address: `localhost` is refused by the guard's name rules, by design. */
    val origin: String = "http://127.0.0.1:${server.address.port}"

    fun url(path: String): String = origin + path

    fun on(
        path: String,
        handler: (HttpExchange) -> Unit,
    ) {
        server.createContext(path) { exchange ->
            try {
                handler(exchange)
            } catch (e: Exception) {
                // A client that walked away mid-body is exactly what several of these tests do.
            } finally {
                exchange.close()
            }
        }
    }

    fun serve(
        path: String,
        body: ByteArray,
        contentType: String? = "text/html; charset=utf-8",
        headers: Map<String, String> = emptyMap(),
    ) {
        on(path) { exchange ->
            contentType?.let { exchange.responseHeaders.set("Content-Type", it) }
            headers.forEach { (name, value) -> exchange.responseHeaders.set(name, value) }
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.write(body)
        }
    }

    fun serveText(
        path: String,
        body: String,
        contentType: String? = "text/html; charset=utf-8",
    ) {
        serve(path, body.toByteArray(Charsets.UTF_8), contentType)
    }

    /** Streams [chunk] [times] over with no `Content-Length`, so the cap has to bite mid-stream. */
    fun serveChunked(
        path: String,
        chunk: ByteArray,
        times: Int,
    ) {
        on(path) { exchange ->
            exchange.responseHeaders.set("Content-Type", "text/html")
            exchange.sendResponseHeaders(200, 0)
            repeat(times) {
                exchange.responseBody.write(chunk)
                exchange.responseBody.flush()
            }
        }
    }

    fun redirect(
        path: String,
        location: String,
        status: Int = 302,
    ) {
        on(path) { exchange ->
            exchange.responseHeaders.set("Location", location)
            exchange.sendResponseHeaders(status, -1)
        }
    }

    fun status(
        path: String,
        status: Int,
    ) {
        on(path) { exchange -> exchange.sendResponseHeaders(status, -1) }
    }

    fun slow(
        path: String,
        delayMillis: Long,
        body: String = "<html><body>late</body></html>",
    ) {
        on(path) { exchange ->
            Thread.sleep(delayMillis)
            val bytes = body.toByteArray()
            exchange.responseHeaders.set("Content-Type", "text/html")
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.write(bytes)
        }
    }

    override fun close() {
        server.stop(0)
        executor.shutdownNow()
    }

    companion object {
        fun gzip(bytes: ByteArray): ByteArray {
            val collected = ByteArrayOutputStream()
            GZIPOutputStream(collected).use { it.write(bytes) }
            return collected.toByteArray()
        }
    }
}
