package dev.vibemotion.api.clone

import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.string.shouldNotContain
import org.jsoup.Jsoup

/**
 * Clones real pages over the real internet with the real guard.
 *
 * Off by default and never part of a gate: a suite that needs the network is a suite that fails for
 * reasons that have nothing to do with the change under review. Run it by hand when the clone
 * pipeline changes:
 *
 * ```
 * VM_CLONE_SMOKE=1 ./gradlew test --tests '*RealWorldCloneSmokeTest*' --info
 * ```
 */
class RealWorldCloneSmokeTest :
    FunSpec({

        val enabled = System.getenv("VM_CLONE_SMOKE") == "1"

        listOf(
            "https://example.com/",
            "https://www.iana.org/help/example-domains",
        ).forEach { url ->
            test("clones $url").config(enabled = enabled) {
                val cloner = HttpPageCloner(PageFetcher(SsrfGuard(), 10L * 1024 * 1024, 15_000))

                val cloned = cloner.clone(url)
                val document = Jsoup.parse(cloned.html)

                println(
                    "SMOKE $url -> title='${cloned.title}' finalUrl=${cloned.finalUrl} " +
                        "elements=${cloned.elementCount} bytes=${cloned.html.length} " +
                        "inlinedStylesheets=${document.select("style[data-vm-source]").size} " +
                        "remainingLinks=${document.select("link[rel=stylesheet]").size}",
                )

                cloned.elementCount shouldBeGreaterThan 0
                cloned.html shouldNotContain "<script"
                document.select("[data-vm-id]").size shouldBeGreaterThan 0
            }
        }
    })
