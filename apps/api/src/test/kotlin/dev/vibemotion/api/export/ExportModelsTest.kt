package dev.vibemotion.api.export

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import kotlinx.serialization.json.Json
import java.util.UUID

private val EXPORT_JSON = Json { encodeDefaults = true }

class ExportModelsTest :
    FunSpec({

        test("the class for an element is its vmId with an 'a' in front of the number") {
            elementClass("vm-1") shouldBe "vm-a1"
            elementClass("vm-17") shouldBe "vm-a17"
            elementClass("vm-0") shouldBe "vm-a0"
            elementClass("vm-2147483647") shouldBe "vm-a2147483647"
        }

        test("the class is derived, so the same vmId always gives the same class") {
            // No allocation table: a snippet pasted into a site last month still matches a full
            // export made today.
            elementClass("vm-42") shouldBe elementClass("vm-42")
        }

        test("anything that is not a clone's vmId is refused rather than turned into a selector") {
            listOf(
                "",
                "vm-",
                "vm-1a",
                "VM-1",
                "vm--1",
                "vm-1 ",
                " vm-1",
                "vm-1;}body{display:none",
                "vm-1.vm-a2",
                "../x",
                "vm-١٧",
            ).forEach { hostile ->
                withClue(hostile) { shouldThrow<IllegalArgumentException> { elementClass(hostile) } }
            }
        }

        test("a refusal never echoes the value it refused") {
            val error = shouldThrow<IllegalArgumentException> { elementClass("vm-1;}body{display:none") }

            error.message.orEmpty() shouldNotContain "display:none"
            error.message.orEmpty() shouldContain "vm-"
        }

        test("the marker, gate and play classes are the fixed names the stylesheet and script share") {
            IN_VIEW_MARKER_CLASS shouldBe "vm-in-view"
            JS_GATE_CLASS shouldBe "vm-js"
            PLAY_CLASS shouldBe "vm-play"
        }

        test("file names are the build plan's and the design handoff's") {
            HTML_FILE.name shouldBe "index.html"
            HTML_FILE.contentType shouldBe "text/html"
            CSS_FILE.name shouldBe "vibe-motion.css"
            CSS_FILE.contentType shouldBe "text/css"
            JS_FILE.name shouldBe "vibe-motion.js"
            JS_FILE.contentType shouldBe "text/javascript"
        }

        test("mode parses the contract's two values and defaults to full") {
            ExportMode.parse(null) shouldBe ExportMode.FULL
            ExportMode.parse("full") shouldBe ExportMode.FULL
            ExportMode.parse("snippet") shouldBe ExportMode.SNIPPET
        }

        test("an unknown mode is a bad request, not a silent default") {
            listOf("Full", "SNIPPET", "", "html", "full ").forEach { raw ->
                withClue(raw) { shouldThrow<IllegalArgumentException> { ExportMode.parse(raw) } }
            }
        }

        test("snippet mode without a vmId is missing_vm_id, which is the code the mock already uses") {
            val error =
                shouldThrow<ExportRequestException> {
                    ExportRequest(projectId = UUID.randomUUID(), mode = ExportMode.SNIPPET, vmId = null)
                }

            error.code shouldBe "missing_vm_id"
        }

        test("snippet mode with a vmId the clone could never have produced is a bad request") {
            shouldThrow<IllegalArgumentException> {
                ExportRequest(projectId = UUID.randomUUID(), mode = ExportMode.SNIPPET, vmId = "vm-1}")
            }
        }

        test("full mode ignores a leftover vmId rather than refusing the request") {
            // The contract only requires `vmId` for snippet mode; a tab that switches back to Full
            // with the query param still attached must still get its page.
            val request = ExportRequest(projectId = UUID.randomUUID(), mode = ExportMode.FULL, vmId = "not a vm id")

            request.mode shouldBe ExportMode.FULL
        }

        test("the bundle serialises html and js as explicit nulls, because the contract requires the keys") {
            val json =
                EXPORT_JSON.encodeToString(
                    ExportBundleDto.serializer(),
                    ExportBundleDto(
                        versionId = "0f1b0a5e-0000-4000-8000-000000000000",
                        mode = ExportMode.SNIPPET,
                        html = null,
                        css = "/* x */",
                        js = null,
                        files = listOf(CSS_FILE),
                    ),
                )

            json shouldContain "\"html\":null"
            json shouldContain "\"js\":null"
            json shouldContain "\"mode\":\"snippet\""
            json shouldContain "\"name\":\"vibe-motion.css\""
        }
    })
