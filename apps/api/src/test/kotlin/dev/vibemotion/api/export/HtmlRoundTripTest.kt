package dev.vibemotion.api.export

import io.kotest.assertions.withClue
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import org.jsoup.Jsoup
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path

private val SCRIPT_TAG = Regex("<script", RegexOption.IGNORE_CASE)
private val EVENT_HANDLER = Regex(""" on[a-z]+\s*=""", RegexOption.IGNORE_CASE)

private val CLONE_GOLDENS = listOf("marketing.html", "docs.html", "hostile.html")

/**
 * What jsoup does to a document on the way through the exporter.
 *
 * The export re-parses and re-serialises `base_html` **unconditionally** rather than patching the
 * stored string: `base_html` is immutable and may have been produced by an older rewriter, and the
 * export runs on the designer's own site with no CSP behind it (DT-073). A string pass would hand
 * the mXSS shapes below to a browser untouched.
 *
 * These are characterisations, not promises. Byte identity with `base_html` is not a requirement;
 * what is required is that nothing executable survives and that every `data-vm-id` becomes exactly
 * one class.
 */
class HtmlRoundTripTest :
    FunSpec({

        val emitter = HtmlEmitter()

        test("a clone golden survives the round trip byte for byte when nothing is assigned") {
            // This is the shape `base_html` actually has, and it is the one that matters: an
            // unassigned export differs from the stored document only by the removed attributes.
            CLONE_GOLDENS.forEach { name ->
                val golden = cloneGolden(name)
                val reparsed = reserialise(golden)

                withClue(name) { reparsed shouldBe golden }
            }
        }

        test("exporting an export is a fixed point, for every document a clone can produce") {
            CLONE_GOLDENS.forEach { name ->
                val once = emitter.emit(cloneGolden(name), emptyMap(), needsScript = false)
                val twice = emitter.emit(once, emptyMap(), needsScript = false)

                withClue(name) { twice shouldBe once }
            }
        }

        test("every data-vm-id becomes exactly one class, on exactly one element") {
            val classes = mapOf("vm-1" to listOf(elementClass("vm-1")), "vm-13" to listOf(elementClass("vm-13")))

            val exported = emitter.emit(cloneGolden("marketing.html"), classes, needsScript = false)
            val document = Jsoup.parse(exported)

            document.select(".vm-a1").size shouldBe 1
            document.select(".vm-a13").size shouldBe 1
            document.selectFirst(".vm-a1").shouldNotBeNull().normalName() shouldBe "header"
            document.selectFirst(".vm-a13").shouldNotBeNull().normalName() shouldBe "img"
            // Nothing else gained one, and the ids themselves are gone.
            document.select("[class*=vm-a]").size shouldBe 2
            document.select("[data-vm-id]").size shouldBe 0
        }

        test("the class is appended: existing tokens and their order are untouched") {
            val html =
                """
                <html><body>
                  <div id="a" data-vm-id="vm-1">no class</div>
                  <div id="b" class="card" data-vm-id="vm-2">one class</div>
                  <div id="c" class="card wide featured" data-vm-id="vm-3">several classes</div>
                </body></html>
                """.trimIndent()
            val classes =
                mapOf(
                    "vm-1" to listOf("vm-a1"),
                    "vm-2" to listOf("vm-a2"),
                    "vm-3" to listOf("vm-a3", IN_VIEW_MARKER_CLASS),
                )

            val document = Jsoup.parse(emitter.emit(html, classes, needsScript = false))

            document.selectFirst("#a").shouldNotBeNull().attr("class") shouldBe "vm-a1"
            document.selectFirst("#b").shouldNotBeNull().attr("class") shouldBe "card vm-a2"
            document.selectFirst("#c").shouldNotBeNull().attr("class") shouldBe "card wide featured vm-a3 vm-in-view"
        }

        test("an element with a data-vm-id and no assignment keeps its classes and loses only the id") {
            val html = """<html><body><p class="lede" data-vm-id="vm-9">x</p></body></html>"""
            val document = Jsoup.parse(emitter.emit(html, emptyMap(), needsScript = false))

            document.selectFirst("p").shouldNotBeNull().attr("class") shouldBe "lede"
            document.selectFirst("p").shouldNotBeNull().hasAttr("data-vm-id") shouldBe false
        }

        test("a hostile corpus exports with nothing executable left in it") {
            hostileCorpus().forEach { (name, html) ->
                val exported = emitter.emit(html, emptyMap(), needsScript = false)

                withClue("$name: $exported") {
                    SCRIPT_TAG.containsMatchIn(exported) shouldBe false
                    EVENT_HANDLER.containsMatchIn(exported) shouldBe false
                    exported shouldNotContain "javascript:"
                    exported shouldNotContain "vbscript:"
                    exported shouldNotContain "<iframe"
                    exported shouldNotContain "<base"

                    // And re-parsing it, as a browser would, still finds nothing to run.
                    val reparsed = Jsoup.parse(exported)
                    reparsed.select("script, iframe, object, embed, base").size shouldBe 0
                    reparsed.getAllElements().forEach { element ->
                        element.attributes().forEach { attribute ->
                            attribute.key.lowercase() shouldNotContain "onerror"
                        }
                    }
                }
            }
        }

        test("the mXSS shapes are text after the first parse and an element after the second, and are inert either way") {
            // `<math><mtext><mglyph><style><img …>` is the classic: the first parse reads the
            // `<img>` as style text, the second reads it as an element. That is exactly why the
            // exporter re-parses and re-sanitises rather than patching the stored string.
            val mxss =
                """<html><body><math><mtext><mglyph><style><img src=x onerror=alert(1)>""" +
                    """</style></mglyph></mtext></math></body></html>"""

            val once = emitter.emit(mxss, emptyMap(), needsScript = false)
            val twice = emitter.emit(once, emptyMap(), needsScript = false)

            once shouldNotContain "onerror"
            twice shouldNotContain "onerror"
        }

        test("a <plaintext> document is inert but not byte-stable across a second export") {
            // Characterisation, and the reason byte identity is not a requirement: PLAINTEXT is
            // raw text, so what the first pass escaped the second pass escapes again. Nothing
            // executable comes back — the content only gets more escaped, never less.
            val plaintext = """<html><body><plaintext><script>alert(1)</script>"""

            val once = emitter.emit(plaintext, emptyMap(), needsScript = false)
            val twice = emitter.emit(once, emptyMap(), needsScript = false)

            once shouldContain "&lt;script&gt;"
            SCRIPT_TAG.containsMatchIn(once) shouldBe false
            SCRIPT_TAG.containsMatchIn(twice) shouldBe false
            twice shouldNotBe once
        }

        test("a nested form is dropped by the parser, so its action never reaches the export") {
            val nested = """<html><body><form action="#"><form action="javascript:alert(1)"><input name="a"></form></form></body></html>"""

            val document = Jsoup.parse(emitter.emit(nested, emptyMap(), needsScript = false))

            document.select("form").forEach { it.attr("action") shouldBe "#" }
            document.selectFirst("input").shouldNotBeNull().attr("name") shouldBe "a"
        }

        test("a leading newline inside <pre> is lost on re-serialisation") {
            // A known, logged cost of the unconditional round trip: the HTML parser drops the
            // newline that immediately follows `<pre>`, and serialising does not put it back.
            val pre = "<html><body><pre>\nkeep me</pre></body></html>"

            emitter.emit(pre, emptyMap(), needsScript = false) shouldContain "<pre>keep me</pre>"
        }

        test("a scripting url inside an svg style block is defused, and the rest of the sheet survives") {
            // `<style>` inside `<svg>` is foreign content: its CSS is a text node, not a data
            // node. Reading only `data()` used to leave it empty and wipe the stylesheet.
            val svg =
                """<html><body><svg><style>a{background:url(javascript:alert(1))} circle{fill:red}</style></svg></body></html>"""

            val exported = emitter.emit(svg, emptyMap(), needsScript = false)

            exported shouldNotContain "javascript:"
            exported shouldContain """url("#")"""
            exported shouldContain "circle{fill:red}"
        }

        test("an svg style block keeps its CSS, which jsoup escapes the same way with or without a rewrite") {
            // Characterisation: foreign content is text, so `>` serialises as `&gt;` — which a
            // browser decodes straight back, because character references *are* processed inside
            // an svg `<style>`. What matters is that this is jsoup's round trip, not ours: an
            // untouched block comes out identical to one we never looked at.
            val svg = "<html><body><svg><style>a > b { fill: red }</style></svg></body></html>"

            val exported = emitter.emit(svg, emptyMap(), needsScript = false)

            exported shouldBe reserialise(svg).replace("</head>", """<link rel="stylesheet" href="vibe-motion.css"></head>""")
            exported shouldContain "a &gt; b { fill: red }"
        }

        test("the document keeps its doctype, language and charset") {
            val exported = emitter.emit(cloneGolden("marketing.html"), emptyMap(), needsScript = false)

            exported shouldContain "<!doctype html>"
            exported shouldContain """<html lang="en">"""
            exported shouldContain """<meta charset="utf-8">"""
        }

        test("an unassigned export differs from base_html only by the removed data-vm- attributes and the link") {
            // `data-vm-source` records which stylesheet the clone inlined. Like `data-vm-id` it is
            // ours, not the page's, so the sanitiser takes the whole namespace back on the way out.
            val golden = cloneGolden("marketing.html")

            val exported = emitter.emit(golden, emptyMap(), needsScript = false)
            val expected =
                Regex(""" data-vm-(id|source)="[^"]*"""")
                    .replace(golden, "")
                    .replace("</head>", """<link rel="stylesheet" href="vibe-motion.css"></head>""")

            exported shouldBe expected
        }

        test("the exported ids are gone from every golden, including the opaque svg and template roots") {
            CLONE_GOLDENS.forEach { name ->
                val exported = emitter.emit(cloneGolden(name), emptyMap(), needsScript = false)

                withClue(name) { Jsoup.parse(exported).select("[data-vm-id]").map { it.tagName() } shouldContainExactly emptyList() }
            }
        }
    })

private fun cloneGolden(name: String): String = Files.readString(Path.of("src/test/resources/clone/expected", name))

/** jsoup's own round trip, with the output settings the clone pipeline used. */
private fun reserialise(html: String): String {
    val document = Jsoup.parse(html)
    document.outputSettings().prettyPrint(false).charset(StandardCharsets.UTF_8)
    return document.outerHtml()
}

private fun hostileCorpus(): List<Pair<String, String>> =
    listOf(
        "plaintext" to """<html><body><plaintext><script>alert(1)</script>""",
        "pre-newline" to "<html><body><pre>\n<script>alert(1)</script></pre></body></html>",
        "nested-form" to """<html><body><form><form action="javascript:alert(1)"></form></form></body></html>""",
        "mglyph-style" to
            """<html><body><math><mtext><mglyph><style><img src=x onerror=alert(1)></style></mglyph></mtext></math></body></html>""",
        "svg-style" to """<html><body><svg><style><img src=x onerror=alert(1)></style></svg></body></html>""",
        "svg-foreignobject" to
            """<html><body><svg><foreignObject><iframe src="javascript:alert(1)"></iframe></foreignObject></svg></body></html>""",
        "ping-and-smil" to
            """<html><body><a href="/x" ping="https://evil.example/t">x</a><svg><set attributeName="href" to="javascript:alert(1)"></set></svg></body></html>""",
        "comment-swallow" to "<html><body><p>x</p><!-- </body --><script>alert(1)</script></body></html>",
        "noscript-markup" to "<html><body><noscript>&lt;img src=x onerror=alert(1)&gt;</noscript></body></html>",
        "base-and-meta" to
            """<html><head><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example/"></head><body></body></html>""",
    )
