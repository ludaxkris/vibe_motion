package dev.vibemotion.api.export

import dev.vibemotion.api.domain.State
import dev.vibemotion.api.domain.Trigger
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import io.kotest.property.checkAll

private val LOAD_STATE: State =
    linkedMapOf(
        "vm-17" to assignment(animationId = "scale-in"),
        "vm-18" to assignment(animationId = "fade-in"),
    )

private val HOVER_STATE: State =
    linkedMapOf(
        "vm-42" to assignment(animationId = "hover-grow", trigger = Trigger.HOVER),
        // No base styles and no custom property of its own -> no resting rule at all.
        "vm-43" to assignment(animationId = "fade-out", trigger = Trigger.HOVER),
    )

private val IN_VIEW_STATE: State =
    linkedMapOf(
        "vm-63" to assignment(animationId = "fade-in-up", trigger = Trigger.IN_VIEW),
        "vm-64" to assignment(animationId = "flip-in-x", trigger = Trigger.IN_VIEW),
    )

/**
 * How each trigger becomes CSS, and what wraps it.
 *
 * `hover` is plain `:hover` with no JavaScript (owner decision 2026-09-20); `in-view` is gated on
 * the class the script puts on `<html>`, held on its first keyframe until it fires, and plays
 * once; and everything but the keyframes sits inside `prefers-reduced-motion: no-preference`, base
 * styles included, so a reader who asks for less motion sees the page untouched (DT-091).
 */
class CssEmitterTriggersTest :
    FunSpec({

        val emitter = CssEmitter(CATALOG)

        fun stylesheet(state: State) = emitter.stylesheet(VERSION_5, state)

        test("load: golden") {
            assertExportGolden("trigger-load.css", stylesheet(LOAD_STATE))
        }

        test("hover: golden") {
            assertExportGolden("trigger-hover.css", stylesheet(HOVER_STATE))
        }

        test("in-view: golden") {
            assertExportGolden("trigger-in-view.css", stylesheet(IN_VIEW_STATE))
        }

        test("everything except the keyframes is inside the reduced-motion media query") {
            listOf(LOAD_STATE, HOVER_STATE, IN_VIEW_STATE).forEach { state ->
                val css = stylesheet(state)
                val mediaStart = css.indexOf("@media (prefers-reduced-motion: no-preference) {")

                withClue(css) {
                    (mediaStart > 0) shouldBe true
                    // Every rule, base styles included, lives after the media query opens.
                    selectorsIn(css).forEach { selector -> (css.indexOf("$selector {") > mediaStart) shouldBe true }
                    // …and every @keyframes before it.
                    Regex("@keyframes ").findAll(css).forEach { (it.range.first < mediaStart) shouldBe true }
                    css.trimEnd().endsWith("}") shouldBe true
                }
            }
        }

        test("hover splits into a resting rule and a :hover rule, and skips the resting one when it would be empty") {
            val css = stylesheet(HOVER_STATE)

            selectorsIn(css) shouldContainExactly listOf(".vm-a42", ".vm-a42:hover", ".vm-a43:hover")
            // The animation is only ever in the `:hover` rule; the properties it reads are not.
            css.substringAfter(".vm-a42 {").substringBefore("}") shouldNotContain "animation:"
            css.substringAfter(".vm-a42 {").substringBefore("}") shouldContain "--vm-scale: 1.05;"
            css.substringAfter(".vm-a42:hover {").substringBefore("}") shouldContain "animation: vm-hover-grow-v1-1-0"
        }

        test("every in-view rule is gated on the script's class, and one hold rule serves them all") {
            val css = stylesheet(IN_VIEW_STATE)

            selectorsIn(css) shouldContainExactly
                listOf(
                    ":where(.vm-js) .vm-a63",
                    ":where(.vm-js) .vm-a64",
                    ":where(.vm-js) .vm-in-view:not(.vm-play)",
                )
            val hold =
                css
                    .substringAfter(":where(.vm-js) .vm-in-view:not(.vm-play) {")
                    .substringBefore("}")
                    .trim()
                    .lines()
                    .map { it.trim() }

            hold shouldContainExactly
                listOf("animation-play-state: paused;", "animation-delay: 0s;", "animation-fill-mode: both;")
        }

        test("a state with no in-view assignment has no hold rule and no vm-js gate") {
            val css = stylesheet(LOAD_STATE + HOVER_STATE)

            css shouldNotContain "vm-in-view"
            css shouldNotContain "vm-js"
        }

        test("no rule has an id or a type selector, and every one is (0,1,0) or (0,2,0)") {
            checkAll(30, states()) { state ->
                selectorsIn(stylesheet(state)).forEach { selector ->
                    withClue(selector) {
                        selector shouldNotContain "#"
                        // Only class, `:where`, `:hover`, `:not` and the descendant combinator.
                        Regex("""^(:where\(\.[a-z-]+\) )?\.[a-z0-9-]+(:hover|:not\(\.[a-z-]+\))?$""").matches(selector) shouldBe true
                        // (0,1,0) like the preview's `[data-vm-id="…"]`, or (0,2,0) for the two
                        // rules that have to win: `:hover` and the hold rule.
                        (classSpecificity(selector) in 1..2) shouldBe true
                    }
                }
            }
        }

        test("the hold rule outranks the assignment rule it has to override") {
            classSpecificity(":where(.vm-js) .vm-a63") shouldBe 1
            classSpecificity(":where(.vm-js) .vm-in-view:not(.vm-play)") shouldBe 2
            classSpecificity(".vm-a42") shouldBe 1
            classSpecificity(".vm-a42:hover") shouldBe 2
        }

        test("nothing anywhere carries !important, whatever the trigger") {
            listOf(LOAD_STATE, HOVER_STATE, IN_VIEW_STATE).forEach { stylesheet(it) shouldNotContain "!important" }
        }

        test("snippet: load golden, with the class to add") {
            val css = emitter.snippet(VERSION_5, "vm-17", assignment(animationId = "scale-in"))

            css shouldContain """/* add class="vm-a17" to the element */"""
            assertExportGolden("snippet-load.css", css)
        }

        test("snippet: hover golden") {
            val css = emitter.snippet(VERSION_5, "vm-42", assignment(animationId = "hover-grow", trigger = Trigger.HOVER))

            css shouldContain """/* add class="vm-a42" to the element */"""
            assertExportGolden("snippet-hover.css", css)
        }

        test("snippet: in-view golden, whose class line also names the marker class") {
            val css = emitter.snippet(VERSION_5, "vm-63", assignment(trigger = Trigger.IN_VIEW))

            css shouldContain """/* add class="vm-a63 vm-in-view" to the element */"""
            assertExportGolden("snippet-in-view.css", css)
        }

        test("a snippet is the same generator scoped to one element, so it cannot disagree with the full export") {
            val full = stylesheet(IN_VIEW_STATE)
            val snippet = emitter.snippet(VERSION_5, "vm-63", IN_VIEW_STATE.getValue("vm-63"))

            snippet shouldContain ":where(.vm-js) .vm-a63 {"
            full.substringAfter(":where(.vm-js) .vm-a63 {").substringBefore("}") shouldBe
                snippet.substringAfter(":where(.vm-js) .vm-a63 {").substringBefore("}")
        }

        test("a snippet carries only its own keyframes") {
            val snippet = emitter.snippet(VERSION_5, "vm-64", IN_VIEW_STATE.getValue("vm-64"))

            snippet shouldContain "@keyframes vm-flip-in-x-v1-1-0 {"
            snippet shouldNotContain "vm-fade-in-up"
        }

        test("every file ends with exactly one newline and uses no carriage returns") {
            listOf(
                stylesheet(LOAD_STATE),
                stylesheet(HOVER_STATE),
                stylesheet(IN_VIEW_STATE),
                emitter.snippet(VERSION_5, "vm-1", assignment()),
                stylesheet(emptyMap()),
            ).forEach { css ->
                css.endsWith("\n") shouldBe true
                css.endsWith("\n\n") shouldBe false
                css shouldNotContain "\r"
                css shouldNotContain "\t"
            }
        }
    })
