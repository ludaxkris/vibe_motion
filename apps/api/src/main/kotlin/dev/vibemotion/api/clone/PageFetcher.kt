package dev.vibemotion.api.clone

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.net.http.HttpTimeoutException
import java.nio.charset.Charset
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.GZIPInputStream

/** An HTML document fetched from the network, decoded to text. */
data class FetchedPage(
    /** The URL the document was finally served from, after redirects. Relative URLs resolve here. */
    val finalUrl: String,
    val html: String,
)

/** A stylesheet fetched from the network. Its own `url(...)` references resolve against [url]. */
data class LoadedStylesheet(
    val url: String,
    val css: String,
)

/** An absolute `nanoTime` instant that every hop of one clone shares. */
@JvmInline
value class Deadline internal constructor(
    internal val atNanos: Long,
)

/**
 * A clone's budget, asked about between units of CPU work rather than between network reads.
 *
 * The fetcher's [Deadline] only ever gated I/O, so a page whose stylesheets take 14 seconds to
 * arrive could still spend minutes being rewritten. [HtmlRewriter] calls this between stages and
 * between stylesheets so that the 15 second budget covers the whole clone.
 */
fun interface DeadlineCheck {
    /** @throws CloneException.Unreachable when the clone's budget is spent. */
    fun check()

    companion object {
        /** For callers with no clone around them: unit tests and the golden rewriter tests. */
        val NONE: DeadlineCheck = DeadlineCheck { }
    }
}

/**
 * Closes a response body once the clone's budget is spent.
 *
 * `HttpRequest.timeout()` only covers the wait for *headers* when the body handler is
 * `ofInputStream()`. After that, `read()` blocks with no timeout of its own, so a server that
 * sends headers and a few bytes and then goes silent used to pin a `Dispatchers.IO` thread for
 * good — and that pool is shared with every database transaction.
 *
 * Closing the JDK's response stream from another thread is what breaks the block: the reader
 * comes back out with an `IOException`, which [PageFetcher.readBounded] maps to
 * [CloneException.Unreachable]. [fired] is how it tells that apart from an ordinary read error.
 */
private class Watchdog private constructor(
    private val task: ScheduledFuture<*>,
    private val timedOut: AtomicBoolean,
) {
    /** True when this watchdog, rather than the peer or the network, ended the read. */
    val fired: Boolean
        get() = timedOut.get()

    fun disarm() {
        task.cancel(false)
    }

    companion object {
        /**
         * One daemon thread for the whole process: a timer per fetch would cost a thread per
         * concurrent clone, which is the very resource this exists to protect.
         */
        private val SCHEDULER: ScheduledExecutorService =
            Executors.newSingleThreadScheduledExecutor { runnable ->
                Thread(runnable, "vm-clone-watchdog").apply { isDaemon = true }
            }

        fun arm(
            body: InputStream,
            withinMillis: Long,
        ): Watchdog {
            val timedOut = AtomicBoolean(false)
            val task =
                SCHEDULER.schedule(
                    Runnable {
                        timedOut.set(true)
                        runCatching { body.close() }
                    },
                    withinMillis,
                    TimeUnit.MILLISECONDS,
                )
            return Watchdog(task, timedOut)
        }
    }
}

/**
 * Fetches the source document and its stylesheets.
 *
 * Everything hostile a URL can do to a fetcher is handled here rather than in the rewriter:
 *
 *  - redirects are followed manually ([MAX_REDIRECTS] at most) so [SsrfGuard] runs on every hop;
 *  - one [Deadline] covers the whole clone, so a chain of individually fast hops still cannot
 *    outlast `CLONE_TIMEOUT_MS`, and a [Watchdog] enforces it on the body itself rather than only
 *    between reads;
 *  - the body is streamed and abandoned the moment it passes the byte cap, and the cap is counted
 *    in *decompressed* bytes, so a gzip bomb costs a buffer rather than the heap.
 *
 * Blocking on purpose: the JDK client's synchronous API keeps the streaming cap simple.
 * [HttpPageCloner] is what moves it onto `Dispatchers.IO`.
 */
class PageFetcher internal constructor(
    private val guard: SsrfGuard,
    private val maxDocumentBytes: Long,
    private val timeoutMs: Long,
    private val client: HttpClient,
    private val nanoTime: () -> Long,
) {
    constructor(
        guard: SsrfGuard,
        maxDocumentBytes: Long,
        timeoutMs: Long,
    ) : this(guard, maxDocumentBytes, timeoutMs, newClient(timeoutMs), System::nanoTime)

    /** A budget for one clone: the document and every stylesheet it pulls in share it. */
    fun newDeadline(): Deadline = Deadline(nanoTime() + timeoutMs * NANOS_PER_MILLI)

    /** The same budget, for the CPU-bound half of a clone. See [DeadlineCheck]. */
    fun deadlineCheck(deadline: Deadline): DeadlineCheck =
        DeadlineCheck {
            if (nanoTime() > deadline.atNanos) throw CloneException.Unreachable("clone timed out after ${timeoutMs}ms")
        }

    fun fetchDocument(
        url: String,
        deadline: Deadline = newDeadline(),
    ): FetchedPage {
        val resource = retrieve(url, ResourceKind.DOCUMENT, maxDocumentBytes, deadline)
        return FetchedPage(resource.url, resource.text)
    }

    /**
     * Capped at [MAX_STYLESHEET_BYTES] regardless of `CLONE_MAX_BYTES`: a single stylesheet that
     * large is a mistake, and the rewriter has a separate budget for the total.
     *
     * Throws like [fetchDocument] does; the caller decides that a stylesheet failure is not a clone
     * failure (a wrong content type surfaces as [CloneException.NotHtml] with a `text/css` message).
     */
    fun fetchStylesheet(
        url: String,
        deadline: Deadline = newDeadline(),
    ): LoadedStylesheet {
        val resource = retrieve(url, ResourceKind.STYLESHEET, MAX_STYLESHEET_BYTES, deadline)
        return LoadedStylesheet(resource.url, resource.text)
    }

    private fun retrieve(
        startUrl: String,
        kind: ResourceKind,
        maxBytes: Long,
        deadline: Deadline,
    ): RawResource {
        var current = startUrl
        var redirects = 0
        while (true) {
            val vetted = guard.vet(current)
            val response = send(vetted.uri, kind, deadline)
            val status = response.statusCode()
            when {
                status in REDIRECT_STATUSES -> {
                    response.body().closeQuietly()
                    if (redirects >= MAX_REDIRECTS) {
                        throw CloneException.Unreachable("redirected more than $MAX_REDIRECTS times")
                    }
                    val location =
                        response.headers().firstValue("location").orElse(null)
                            ?: throw CloneException.Unreachable("answered $status without a Location header")
                    redirects++
                    current =
                        resolveUrl(current, location)
                            ?: throw CloneException.Unreachable("redirected to a location that is not a URL")
                }

                status in 200..299 -> {
                    return read(response, current, kind, maxBytes, deadline)
                }

                else -> {
                    response.body().closeQuietly()
                    throw CloneException.Unreachable("answered with HTTP $status")
                }
            }
        }
    }

    private fun send(
        uri: URI,
        kind: ResourceKind,
        deadline: Deadline,
    ): HttpResponse<InputStream> {
        val request =
            HttpRequest
                .newBuilder(uri)
                .GET()
                .timeout(Duration.ofMillis(remainingMillis(deadline)))
                .header("User-Agent", USER_AGENT)
                .header("Accept", kind.accept)
                .header("Accept-Encoding", "gzip")
                .build()
        return try {
            client.send(request, HttpResponse.BodyHandlers.ofInputStream())
        } catch (e: HttpTimeoutException) {
            throw CloneException.Unreachable("did not answer within ${timeoutMs}ms", e)
        } catch (e: IOException) {
            throw CloneException.Unreachable("could not be reached", e)
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            throw CloneException.Unreachable("was interrupted", e)
        }
    }

    private fun read(
        response: HttpResponse<InputStream>,
        url: String,
        kind: ResourceKind,
        maxBytes: Long,
        deadline: Deadline,
    ): RawResource {
        val contentType = response.headers().firstValue("content-type").orElse(null)
        val mime =
            contentType
                ?.substringBefore(';')
                ?.trim()
                ?.lowercase(Locale.ROOT)
                ?.takeIf { it.isNotEmpty() }
        if (mime != null && mime !in kind.acceptedTypes) {
            response.body().closeQuietly()
            throw CloneException.NotHtml("served '$mime'; ${kind.expectation}")
        }
        val announced = response.headers().firstValueAsLong("content-length").orElse(-1L)
        if (announced > maxBytes) {
            response.body().closeQuietly()
            throw CloneException.TooLarge("announced $announced bytes, over the $maxBytes byte limit")
        }
        val encoding = response.headers().firstValue("content-encoding").orElse("")
        val gzipped = encoding.trim().equals("gzip", ignoreCase = true)
        val body = response.body()
        val watchdog = Watchdog.arm(body, millisLeft(deadline))
        val bytes =
            try {
                body.use { readBounded(it, gzipped, maxBytes, deadline, watchdog) }
            } finally {
                watchdog.disarm()
            }
        val text = decode(bytes, charsetFor(contentType, bytes))
        if (mime == null && kind == ResourceKind.DOCUMENT && !looksLikeHtml(text)) {
            throw CloneException.NotHtml("announced no content type and does not look like HTML")
        }
        return RawResource(url, text)
    }

    /**
     * Reads at most [maxBytes] *decompressed* bytes, then gives up. Counting after decompression
     * and before buffering is what makes this safe against a body that inflates to gigabytes.
     *
     * The deadline check between reads is not enough on its own: `read()` itself blocks with no
     * timeout, so a server that sends headers and then goes silent would pin this thread forever.
     * [watchdog] closes the body underneath us when the budget runs out, which turns that block
     * into an `IOException` — hence the two-armed catch below.
     */
    private fun readBounded(
        source: InputStream,
        gzipped: Boolean,
        maxBytes: Long,
        deadline: Deadline,
        watchdog: Watchdog,
    ): ByteArray {
        val collected = ByteArrayOutputStream(INITIAL_BUFFER_BYTES)
        val chunk = ByteArray(READ_CHUNK_BYTES)
        var total = 0L
        try {
            val stream = if (gzipped) GZIPInputStream(source) else source
            while (true) {
                if (nanoTime() > deadline.atNanos) {
                    throw CloneException.Unreachable("did not finish within ${timeoutMs}ms")
                }
                val read = stream.read(chunk)
                if (read < 0) break
                total += read
                if (total > maxBytes) {
                    throw CloneException.TooLarge("is larger than the $maxBytes byte limit")
                }
                collected.write(chunk, 0, read)
            }
        } catch (e: IOException) {
            if (watchdog.fired) throw CloneException.Unreachable("stopped sending within ${timeoutMs}ms", e)
            throw CloneException.Unreachable("could not be read to the end", e)
        }
        return collected.toByteArray()
    }

    private fun remainingMillis(deadline: Deadline): Long {
        val remaining = (deadline.atNanos - nanoTime()) / NANOS_PER_MILLI
        if (remaining <= 0) throw CloneException.Unreachable("did not finish within ${timeoutMs}ms")
        return remaining
    }

    /**
     * Like [remainingMillis] but never throws: a watchdog armed with 1 ms simply fires at once, and
     * the deadline check at the head of [readBounded] is what turns that into the right exception.
     * Arming must not be the thing that leaves an unread body holding a connection open.
     */
    private fun millisLeft(deadline: Deadline): Long = ((deadline.atNanos - nanoTime()) / NANOS_PER_MILLI).coerceAtLeast(1)

    private enum class ResourceKind(
        val accept: String,
        val acceptedTypes: Set<String>,
        val expectation: String,
    ) {
        DOCUMENT(
            accept = "text/html,application/xhtml+xml",
            acceptedTypes = setOf("text/html", "application/xhtml+xml"),
            expectation = "only HTML pages can be cloned",
        ),
        STYLESHEET(
            accept = "text/css,*/*;q=0.1",
            acceptedTypes = setOf("text/css"),
            expectation = "expected text/css",
        ),
    }

    private data class RawResource(
        val url: String,
        val text: String,
    )

    companion object {
        /** Kept in step with `docs/build_plan.md`: at most three hops, each one re-checked. */
        const val MAX_REDIRECTS: Int = 3

        /** One stylesheet's own cap; [HtmlRewriter] caps the total across all of them. */
        const val MAX_STYLESHEET_BYTES: Long = 1L * 1024 * 1024

        private const val NANOS_PER_MILLI = 1_000_000L
        private const val CONNECT_TIMEOUT_MS = 5_000L
        private const val READ_CHUNK_BYTES = 16 * 1024
        private const val INITIAL_BUFFER_BYTES = 64 * 1024
        private const val SNIFF_CHARACTERS = 2048

        private val REDIRECT_STATUSES = setOf(301, 302, 303, 307, 308)

        /**
         * A fixed, honest desktop User-Agent. Fixed because the clone has to be reproducible, and
         * a page that serves us a mobile layout today and a desktop one tomorrow is not.
         */
        private const val USER_AGENT =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/126.0.0.0 Safari/537.36 VibeMotion/0.1 (+https://github.com/vibe-motion)"

        private val CHARSET_IN_CONTENT_TYPE = Regex("""charset\s*=\s*"?([A-Za-z0-9_:.+-]+)"?""", RegexOption.IGNORE_CASE)
        private val CHARSET_IN_META =
            Regex("""<meta[^>]*charset\s*=\s*["']?\s*([A-Za-z0-9_:.+-]+)""", RegexOption.IGNORE_CASE)

        private fun newClient(timeoutMs: Long): HttpClient =
            HttpClient
                .newBuilder()
                // Redirects are followed by hand so the guard sees every hop.
                .followRedirects(HttpClient.Redirect.NEVER)
                .connectTimeout(Duration.ofMillis(minOf(CONNECT_TIMEOUT_MS, timeoutMs).coerceAtLeast(1)))
                // HTTP/1.1 keeps behaviour identical between real sites and the test fixture server.
                .version(HttpClient.Version.HTTP_1_1)
                // A system proxy would connect somewhere the guard never vetted.
                .proxy(HttpClient.Builder.NO_PROXY)
                .build()

        private fun InputStream.closeQuietly() {
            runCatching { close() }
        }

        private fun charsetFor(
            contentType: String?,
            bytes: ByteArray,
        ): Charset {
            contentType?.let { header ->
                CHARSET_IN_CONTENT_TYPE.find(header)?.let { match ->
                    charsetOrNull(match.groupValues[1])?.let { return it }
                }
            }
            val prefix = String(bytes, 0, minOf(bytes.size, SNIFF_CHARACTERS), StandardCharsets.ISO_8859_1)
            CHARSET_IN_META.find(prefix)?.let { match ->
                charsetOrNull(match.groupValues[1])?.let { return it }
            }
            return StandardCharsets.UTF_8
        }

        private fun charsetOrNull(name: String): Charset? = runCatching { Charset.forName(name.trim()) }.getOrNull()

        private fun decode(
            bytes: ByteArray,
            charset: Charset,
        ): String {
            val hasUtf8Bom =
                bytes.size >= 3 &&
                    (bytes[0].toInt() and 0xFF) == 0xEF &&
                    (bytes[1].toInt() and 0xFF) == 0xBB &&
                    (bytes[2].toInt() and 0xFF) == 0xBF
            return if (hasUtf8Bom) {
                String(bytes, 3, bytes.size - 3, StandardCharsets.UTF_8)
            } else {
                String(bytes, charset)
            }
        }

        private fun looksLikeHtml(text: String): Boolean {
            val prefix = text.take(SNIFF_CHARACTERS).lowercase(Locale.ROOT)
            return prefix.contains("<html") || prefix.contains("<!doctype") || prefix.contains("<body")
        }
    }
}
