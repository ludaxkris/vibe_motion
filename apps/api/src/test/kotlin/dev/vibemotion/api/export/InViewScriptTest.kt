package dev.vibemotion.api.export

import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import java.nio.file.Files
import java.nio.file.Path

/**
 * The script is a constant the API only has to hand over intact, so this is about identity, not
 * behaviour: what it does is proved in a real browser by `packages/bridge/e2e/export-script.spec.ts`.
 */
class InViewScriptTest :
    FunSpec({

        test("is on the classpath and is the file packages/bridge owns, byte for byte") {
            val source = InViewScript.source()

            source shouldBe Files.readString(Path.of("../../packages/bridge/src/vibe-motion-export.js"))
            source.length shouldBeGreaterThan 500
        }

        test("reading it twice gives the same instance, so an export does not re-read the jar") {
            InViewScript.source() shouldBe InViewScript.source()
        }

        test("uses exactly the class names the stylesheet and the HTML emitter agree on") {
            val source = InViewScript.source()

            source shouldContain """var GATE_CLASS = "$JS_GATE_CLASS";"""
            source shouldContain """var MARKER_CLASS = "$IN_VIEW_MARKER_CLASS";"""
            source shouldContain """var PLAY_CLASS = "$PLAY_CLASS";"""
        }

        test("carries no placeholder anything could be interpolated into") {
            val source = InViewScript.source()

            source shouldNotContain "\${"
            source shouldNotContain "{{"
            source shouldNotContain "%s"
        }
    })
