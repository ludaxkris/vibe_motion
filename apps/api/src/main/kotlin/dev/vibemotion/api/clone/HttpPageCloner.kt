package dev.vibemotion.api.clone

import dev.vibemotion.api.config.AppConfig
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.slf4j.LoggerFactory
import java.io.IOException
import java.net.URISyntaxException

/**
 * The production [PageCloner]: guard, then fetch, then rewrite.
 *
 * One [Deadline] covers the document, every stylesheet, and the rewrite stages in between, so a
 * page with thirty slow stylesheets — or one hostile one — cannot stretch a 15 second clone into
 * ten minutes. A stylesheet that fails is dropped and the rewriter keeps its `<link>`; only the
 * document itself can fail a clone.
 *
 * At most [maxConcurrentClones] clones run per instance. A worst-case clone peaks somewhere around
 * 110-140 MB of heap (read, decode, jsoup DOM and `outerHtml()` all alive at once), against roughly
 * 300 MB usable on a Render starter instance: two fit, three do not, and an `OutOfMemoryError` on a
 * shared [Dispatchers.IO] worker takes unrelated requests down with it. Excess callers wait
 * [acquireTimeoutMs] and then get [CloneException.Busy] rather than queueing behind a proxy timeout.
 *
 * The work is blocking (the JDK HTTP client's synchronous API, then jsoup), so it runs on
 * [Dispatchers.IO] rather than on a Ktor event-loop thread. The permit is acquired *outside* that
 * dispatcher, so waiting for one does not itself occupy an IO thread.
 */
class HttpPageCloner(
    private val fetcher: PageFetcher,
    private val rewriter: HtmlRewriter = HtmlRewriter(),
    private val dispatcher: CoroutineDispatcher = Dispatchers.IO,
    maxConcurrentClones: Int = DEFAULT_MAX_CONCURRENT_CLONES,
    private val acquireTimeoutMs: Long = DEFAULT_ACQUIRE_TIMEOUT_MS,
) : PageCloner {
    private val permits = Semaphore(maxConcurrentClones)

    override suspend fun clone(url: String): ClonedPage {
        withTimeoutOrNull(acquireTimeoutMs) { permits.acquire() }
            ?: throw CloneException.Busy(
                "This server is already cloning other pages; try again shortly",
                retryAfterSeconds = RETRY_AFTER_SECONDS,
            )
        try {
            return fetchAndRewrite(url)
        } finally {
            permits.release()
        }
    }

    private suspend fun fetchAndRewrite(url: String): ClonedPage =
        withContext(dispatcher) {
            try {
                val deadline = fetcher.newDeadline()
                val page = fetcher.fetchDocument(url, deadline)
                val loader: StylesheetLoader = { stylesheetUrl -> loadStylesheet(stylesheetUrl, deadline) }
                rewriter.rewrite(page.html, page.finalUrl, loader, fetcher.deadlineCheck(deadline))
            } catch (e: CloneException) {
                throw e
            } catch (e: IOException) {
                throw CloneException.Unreachable("'$url' could not be fetched", e)
            } catch (e: URISyntaxException) {
                throw CloneException.InvalidUrl("'$url' is not a valid URL")
            } catch (e: IllegalArgumentException) {
                throw CloneException.InvalidUrl("'$url' is not a valid URL")
            }
        }

    /**
     * Almost every stylesheet failure is the same failure: we keep the absolute `<link>` and move
     * on. The reason is logged at debug rather than surfaced, because a page missing one of its
     * forty stylesheets is still a page the designer can work on.
     *
     * The exception is a URL the guard refused, which the rewriter drops outright — see
     * [StylesheetFetch.Blocked].
     */
    private fun loadStylesheet(
        url: String,
        deadline: Deadline,
    ): StylesheetFetch =
        try {
            StylesheetFetch.Loaded(fetcher.fetchStylesheet(url, deadline))
        } catch (e: CloneException.Blocked) {
            log.debug("Dropping stylesheet '{}': {}", url, e.code)
            StylesheetFetch.Blocked
        } catch (e: CloneException) {
            log.debug("Leaving stylesheet '{}' linked: {}", url, e.code)
            StylesheetFetch.Unavailable
        } catch (e: IOException) {
            log.debug("Leaving stylesheet '{}' linked", url, e)
            StylesheetFetch.Unavailable
        }

    companion object {
        /** Two worst-case clones fit in a starter instance's heap. Three do not. */
        const val DEFAULT_MAX_CONCURRENT_CLONES: Int = 2

        /** Long enough to ride out a normal clone, short enough to beat a proxy's own timeout. */
        const val DEFAULT_ACQUIRE_TIMEOUT_MS: Long = 5_000

        private const val RETRY_AFTER_SECONDS = 5

        private val log = LoggerFactory.getLogger(HttpPageCloner::class.java)

        /** The wiring the application uses: real DNS, real sockets, the configured caps. */
        fun create(config: AppConfig): HttpPageCloner {
            // Before the first lookup: the guard and the HTTP client must agree on what a host
            // resolves to, and they only do that through this cache.
            DnsCachePolicy.apply()
            return HttpPageCloner(
                PageFetcher(
                    guard = SsrfGuard(),
                    maxDocumentBytes = config.cloneMaxBytes,
                    timeoutMs = config.cloneTimeoutMs,
                ),
            )
        }
    }
}
