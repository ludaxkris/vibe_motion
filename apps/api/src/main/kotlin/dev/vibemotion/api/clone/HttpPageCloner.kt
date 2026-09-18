package dev.vibemotion.api.clone

import dev.vibemotion.api.config.AppConfig
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.slf4j.LoggerFactory
import java.io.IOException
import java.net.URISyntaxException

/**
 * The production [PageCloner]: guard, then fetch, then rewrite.
 *
 * One [Deadline] covers the document and every stylesheet, so a page with thirty slow stylesheets
 * cannot stretch a 15 second clone into ten minutes. A stylesheet that fails is dropped to null and
 * the rewriter keeps its `<link>`; only the document itself can fail a clone.
 *
 * The work is blocking (the JDK HTTP client's synchronous API, then jsoup), so it runs on
 * [Dispatchers.IO] rather than on a Ktor event-loop thread.
 */
class HttpPageCloner(
    private val fetcher: PageFetcher,
    private val rewriter: HtmlRewriter = HtmlRewriter(),
    private val dispatcher: CoroutineDispatcher = Dispatchers.IO,
) : PageCloner {
    override suspend fun clone(url: String): ClonedPage =
        withContext(dispatcher) {
            try {
                val deadline = fetcher.newDeadline()
                val page = fetcher.fetchDocument(url, deadline)
                rewriter.rewrite(page.html, page.finalUrl) { stylesheetUrl ->
                    loadStylesheet(stylesheetUrl, deadline)
                }
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
     * Every stylesheet failure is the same failure: we keep the absolute `<link>` and move on. The
     * reason is logged at debug rather than surfaced, because a page that is missing one of its
     * forty stylesheets is still a page the designer can work on.
     */
    private fun loadStylesheet(
        url: String,
        deadline: Deadline,
    ): LoadedStylesheet? =
        try {
            fetcher.fetchStylesheet(url, deadline)
        } catch (e: CloneException) {
            log.debug("Leaving stylesheet '{}' linked: {}", url, e.code)
            null
        } catch (e: IOException) {
            log.debug("Leaving stylesheet '{}' linked", url, e)
            null
        }

    companion object {
        private val log = LoggerFactory.getLogger(HttpPageCloner::class.java)

        /** The wiring the application uses: real DNS, real sockets, the configured caps. */
        fun create(config: AppConfig): HttpPageCloner =
            HttpPageCloner(
                PageFetcher(
                    guard = SsrfGuard(),
                    maxDocumentBytes = config.cloneMaxBytes,
                    timeoutMs = config.cloneTimeoutMs,
                ),
            )
    }
}
