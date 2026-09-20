package dev.vibemotion.api.export

import io.kotest.assertions.withClue
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import org.jsoup.Jsoup
import java.nio.file.Files
import java.nio.file.Path

private val SCRIPT_TAG = Regex("<script", RegexOption.IGNORE_CASE)
private val EVENT_HANDLER = Regex(""" on[a-z]+\s*=""", RegexOption.IGNORE_CASE)

private val GOLDENS = listOf("marketing.html", "docs.html", "hostile.html")

/**
 * What `index.html` gains and loses, on the documents the clone pipeline actually produces.
 */
class HtmlEmitterTest :
    FunSpec({

        val emitter = HtmlEmitter()

        test("the stylesheet link is the last child of head") {
            GOLDENS.forEach { name ->
                val document = Jsoup.parse(emitter.emit(golden(name), emptyMap(), needsScript = false))
                val last =
                    document
                        .head()
                        .children()
                        .last()
                        .shouldNotBeNull()

                withClue(name) {
                    last.normalName() shouldBe "link"
                    last.attr("rel") shouldBe "stylesheet"
                    last.attr("href") shouldBe "vibe-motion.css"
                    document.select("""head link[href="vibe-motion.css"]""").size shouldBe 1
                }
            }
        }

        test("the script follows the link, is not deferred, and is present only when it is needed") {
            val without = Jsoup.parse(emitter.emit(golden("marketing.html"), emptyMap(), needsScript = false))
            without.select("script").size shouldBe 0

            val with = Jsoup.parse(emitter.emit(golden("marketing.html"), emptyMap(), needsScript = true))
            val tail =
                with
                    .head()
                    .children()
                    .takeLast(2)
                    .map { it.normalName() }

            tail shouldContainExactly listOf("link", "script")
            val script =
                with
                    .head()
                    .children()
                    .last()
                    .shouldNotBeNull()
            script.attr("src") shouldBe "vibe-motion.js"
            // Deferred, an in-view element in the first viewport would paint at rest, snap to its
            // first keyframe when `vm-js` lands, then play. The cost is one small blocking request.
            script.hasAttr("defer") shouldBe false
            script.hasAttr("async") shouldBe false
        }

        test("the script element is serialised with a closing tag, not as a void element") {
            emitter.emit(golden("marketing.html"), emptyMap(), needsScript = true) shouldContain
                """<script src="vibe-motion.js"></script>"""
        }

        test("an export of an export does not stack a second link or script") {
            val once = emitter.emit(golden("marketing.html"), emptyMap(), needsScript = true)
            val twice = emitter.emit(once, emptyMap(), needsScript = true)

            twice shouldBe once
            Jsoup.parse(twice).select("""link[href="vibe-motion.css"]""").size shouldBe 1
            Jsoup.parse(twice).select("script").size shouldBe 1
        }

        test("an unassigned export differs from base_html only by the removed attributes and the link") {
            val base = golden("marketing.html")

            val exported = emitter.emit(base, emptyMap(), needsScript = false)
            val expected =
                Regex(""" data-vm-(id|source)="[^"]*"""")
                    .replace(base, "")
                    .replace("</head>", """<link rel="stylesheet" href="vibe-motion.css"></head>""")

            exported shouldBe expected
        }

        test("every data-vm-id is gone from every golden") {
            GOLDENS.forEach { name ->
                val exported = emitter.emit(golden(name), mapOf("vm-1" to listOf("vm-a1")), needsScript = true)

                withClue(name) { Jsoup.parse(exported).select("[data-vm-id]").size shouldBe 0 }
            }
        }

        test("the marker class travels beside the element class for an in-view assignment") {
            val classes =
                mapOf(
                    "vm-10" to listOf(elementClass("vm-10")),
                    "vm-15" to listOf(elementClass("vm-15"), IN_VIEW_MARKER_CLASS),
                )

            val document = Jsoup.parse(emitter.emit(golden("marketing.html"), classes, needsScript = true))

            // `<h1>` had no class at all; `<a class="cta">` had one.
            document.selectFirst("h1").shouldNotBeNull().attr("class") shouldBe "vm-a10"
            document.selectFirst("a[href$=signup]").shouldNotBeNull().attr("class") shouldBe "cta vm-a15 vm-in-view"
            document.select(".vm-in-view").size shouldBe 1
        }

        test("a class lands on an element that already has several, after all of them") {
            val document =
                Jsoup.parse(emitter.emit(golden("marketing.html"), mapOf("vm-9" to listOf("vm-a9")), needsScript = false))

            // `<section id="features" class="hero" …>`
            document.selectFirst("#features").shouldNotBeNull().attr("class") shouldBe "hero vm-a9"
        }

        test("the hostile golden exports with nothing that could run on the designer's site") {
            val exported = emitter.emit(golden("hostile.html"), mapOf("vm-1" to listOf("vm-a1")), needsScript = true)

            // The one script is ours, and it is a src, not inline.
            SCRIPT_TAG.findAll(exported).count() shouldBe 1
            exported shouldContain """<script src="vibe-motion.js"></script>"""
            EVENT_HANDLER.containsMatchIn(exported) shouldBe false
            exported shouldNotContain "javascript:"
            exported shouldNotContain "vbscript:"
            exported shouldNotContain "<base"
            exported shouldNotContain "<iframe"
            exported shouldNotContain "ping="
            exported shouldNotContain "data:text/html"
        }

        test("the hostile golden's forms stay disarmed and its SMIL stays gone") {
            val document = Jsoup.parse(emitter.emit(golden("hostile.html"), emptyMap(), needsScript = false))

            document.select("form").forEach { it.attr("action") shouldBe "#" }
            document.select("form[target]").size shouldBe 0
            document.select("animate, set, animatemotion").size shouldBe 0
        }

        test("a document with no head still gets its link") {
            val exported = emitter.emit("<p data-vm-id=\"vm-1\">x</p>", mapOf("vm-1" to listOf("vm-a1")), needsScript = false)

            Jsoup.parse(exported).select("""head link[href="vibe-motion.css"]""").size shouldBe 1
            exported shouldContain """class="vm-a1""""
        }
    })

private fun golden(name: String): String = Files.readString(Path.of("src/test/resources/clone/expected", name))
