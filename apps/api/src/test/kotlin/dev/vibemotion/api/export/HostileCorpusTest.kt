package dev.vibemotion.api.export

import io.kotest.assertions.withClue
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import org.jsoup.Jsoup
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.name

private val CORPUS_DIR = Path.of("src/test/resources/export/hostile")

private const val RAW_TEXT_IN_FOREIGN = "style, xmp, noembed, noframes, plaintext, noscript, iframe, script"

private val INTEGRATION_POINTS = setOf("foreignobject", "desc", "title", "mtext", "mi", "mo", "mn", "ms")

private val EVENT_HANDLER_NAME = Regex("""on[a-z]+""")

/** A scheme that executes, read after whitespace is stripped (`java\nscript:` navigates). */
private val SCRIPTING_SCHEME = Regex("""^(javascript|vbscript):|^data:text/html""", RegexOption.IGNORE_CASE)

/**
 * The one document the round trip is deliberately **not** a fixed point of: `PLAINTEXT` is raw
 * text, so what one pass escapes the next escapes again (characterised in [HtmlRoundTripTest], and
 * logged). Everything else must be stable, because instability is the tell that a browser and
 * jsoup are building different trees from the same bytes — it is how the MathML `<style>`
 * differential announced itself.
 *
 * `<pre>` is *not* on this list: it loses its leading newline going from `base_html` to the export,
 * and is a fixed point from then on.
 */
private val KNOWN_UNSTABLE = setOf("plaintext")

/**
 * The hostile corpus: the inputs, and the exported bytes they produce.
 *
 * **jsoup is not an oracle for how a browser parses.** Re-parsing our own output with jsoup proves
 * only what jsoup sees in it; a parser differential — markup jsoup serialises one way and a browser
 * reads another — is invisible from here. So this spec's real job is to *produce* the goldens under
 * `golden/export/hostile/`, which `packages/bridge/e2e/export-hostile.spec.ts` then opens in
 * Chromium and holds to the only standard that counts: nothing runs.
 *
 * The assertions below are the cheap half, kept because they fail faster and name the problem.
 * Every fixture is inert by construction: the payloads set `window.__vmExecuted`, never anything
 * real.
 *
 * Regenerate with `VM_UPDATE_GOLDEN=1 ./gradlew test` and read every diff.
 */
class HostileCorpusTest :
    FunSpec({

        val emitter = HtmlEmitter()
        val corpus = Files.list(CORPUS_DIR).use { paths -> paths.sorted().toList() }

        test("every input has a golden and every golden has an input") {
            // Not a sorted list against itself: an input with no golden fails loudly on the next
            // test, but an orphan golden would be served to the browser gate for ever with no
            // source to regenerate it from.
            val goldens =
                Files.list(GOLDEN_DIR.resolve("hostile")).use { paths ->
                    paths.map { it.name }.sorted().toList()
                }

            goldens shouldContainExactly corpus.map { it.name }
            corpus.size shouldBeGreaterThan 10
            // The document that proved jsoup is not an oracle. If it ever leaves the corpus, that
            // has to be a deliberate decision, not an accident.
            corpus.any { it.name == "nested-form-mathml-style.html" } shouldBe true
        }

        test("every hostile document exports to its golden") {
            corpus.forEach { source ->
                val exported = emitter.emit(Files.readString(source), emptyMap(), needsScript = false)

                assertExportGolden("hostile/${source.name}", exported)
            }
        }

        test("no exported document carries a live event handler, script or scripting URL") {
            // Attributes and elements, not raw substrings: an escaped `onerror=` inside a `title`
            // attribute value is text, and text is inert. What matters is whether anything is an
            // attribute or an element, and — because jsoup is not the judge of that — whether
            // Chromium agrees. `export-hostile.spec.ts` asks Chromium the same questions.
            corpus.forEach { source ->
                val exported = emitter.emit(Files.readString(source), emptyMap(), needsScript = true)
                val document = Jsoup.parse(exported)

                withClue("${source.name}: $exported") {
                    document.select("script:not([src=vibe-motion.js])").size shouldBe 0
                    document
                        .getAllElements()
                        .flatMap { element -> element.attributes().map { element.normalName() to it } }
                        .filter { (_, attribute) -> EVENT_HANDLER_NAME.matches(attribute.key.lowercase()) }
                        .map { (tag, attribute) -> "$tag[${attribute.key}]" } shouldContainExactly emptyList()
                    document
                        .getAllElements()
                        .flatMap { element -> element.attributes().map { it.value } }
                        .filter { value -> SCRIPTING_SCHEME.containsMatchIn(value.filterNot(Char::isWhitespace)) }
                        .shouldContainExactly(emptyList())
                }
            }
        }

        test("the only raw-text element kept inside foreign content is an inert svg style") {
            corpus.forEach { source ->
                val exported = emitter.emit(Files.readString(source), emptyMap(), needsScript = false)
                val document = Jsoup.parse(exported)

                withClue("${source.name}: $exported") {
                    // Nothing at all under `math`.
                    document.select("math").flatMap { it.select(RAW_TEXT_IN_FOREIGN) }.map { it.normalName() } shouldContainExactly
                        emptyList()

                    document.select("svg").flatMap { it.select(RAW_TEXT_IN_FOREIGN) }.forEach { kept ->
                        // A `<style>`, a leaf, and nothing in its bytes that could open a tag.
                        kept.normalName() shouldBe "style"
                        kept.children().size shouldBe 0
                        kept.html() shouldNotContain "<"
                        // No integration point between it and its NEAREST svg ancestor, which is
                        // what `foreignContext()` walks to. `svg > foreignObject > svg > style` is
                        // therefore kept: the inner `<svg>` puts the block back in plain foreign
                        // content.
                        kept
                            .parents()
                            .takeWhile { it.normalName() != "svg" }
                            .map { it.normalName() }
                            .none { it in INTEGRATION_POINTS } shouldBe true
                    }
                }
            }
        }

        test("a benign inline icon keeps its own stylesheet, defused but intact") {
            val exported = emitter.emit(Files.readString(CORPUS_DIR.resolve("icon-style.html")), emptyMap(), needsScript = false)
            val css =
                Jsoup
                    .parse(exported)
                    .selectFirst("svg style")
                    ?.wholeText()
                    .orEmpty()

            css shouldContain ".icon-dot { fill: rgb(0, 128, 0); }"
            css shouldContain "svg > circle"
        }

        test("exporting an export is a fixed point for every document but the one known characterisation") {
            corpus.forEach { source ->
                val once = emitter.emit(Files.readString(source), emptyMap(), needsScript = true)
                val twice = emitter.emit(once, emptyMap(), needsScript = true)
                val name = source.name.removeSuffix(".html")

                withClue("$name\n--- once:\n$once\n--- twice:\n$twice") {
                    if (name in KNOWN_UNSTABLE) {
                        // Allow-listed, and asserted to still be unstable so the list cannot rot.
                        (twice != once) shouldBe true
                    } else {
                        twice shouldBe once
                    }
                }
            }
        }
    })
