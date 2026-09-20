package dev.vibemotion.api.export

import dev.vibemotion.api.domain.Diff
import dev.vibemotion.api.domain.State
import dev.vibemotion.api.domain.Trigger
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import java.nio.file.Files
import java.nio.file.Path

private val MARKETING_CLONE: String = Files.readString(Path.of("src/test/resources/clone/expected/marketing.html"))

/** Load only, including an entry with base styles and a custom property. */
private val LOAD_ONLY: State =
    linkedMapOf(
        "vm-10" to assignment(animationId = "fade-in-up"),
        "vm-11" to assignment(animationId = "fade-in", params = mapOf("delay" to "200ms")),
        "vm-13" to assignment(animationId = "scale-in"),
    )

/** Both JavaScript-adjacent triggers at once: plain `:hover`, and the held `in-view` group. */
private val HOVER_AND_IN_VIEW: State =
    linkedMapOf(
        "vm-2" to assignment(animationId = "hover-lift", trigger = Trigger.HOVER),
        "vm-15" to assignment(animationId = "hover-grow", trigger = Trigger.HOVER),
        "vm-17" to assignment(animationId = "fade-in-left", trigger = Trigger.IN_VIEW),
        "vm-23" to assignment(animationId = "fade-in", trigger = Trigger.IN_VIEW),
    )

/** Two catalog pins in one page, one of them from before `fillMode` existed. */
private val MIXED_PINS: State =
    linkedMapOf(
        "vm-9" to assignment(animationId = "underline-sweep", catalogVersion = "1.0.0"),
        "vm-10" to assignment(animationId = "fade-in-up", catalogVersion = "1.1.0", params = mapOf("distance" to "48px")),
        "vm-15" to assignment(animationId = "hover-grow", catalogVersion = "1.0.0", trigger = Trigger.HOVER),
        "vm-24" to assignment(animationId = "spin", catalogVersion = "1.1.0"),
    )

/**
 * The whole bundle, for three states, over a real clone golden — the Phase 7 exit criterion's
 * golden half.
 *
 * These go through [ExportService], not the emitters, so what is committed is exactly what a
 * designer downloads. Regenerate deliberately with `VM_UPDATE_GOLDEN=1 ./gradlew test` and read
 * the diff: a change here is a change to every page exported from now on, on somebody else's site.
 */
class ExportGoldenTest :
    FunSpec({

        fun projectWith(state: State): Pair<FakeExportRepositories, ExportService> {
            val repositories = FakeExportRepositories()
            repositories.baseHtml = MARKETING_CLONE
            repositories.addVersion(0, Diff.EMPTY)
            repositories.addVersion(1, Diff(set = state))
            return repositories to ExportService(repositories, repositories, CATALOG, repositories)
        }

        suspend fun exportOf(state: State): ExportBundleDto {
            val (repositories, service) = projectWith(state)
            return service.export(ExportRequest(projectId = repositories.projectId))
        }

        suspend fun assertBundleGolden(
            name: String,
            state: State,
        ) {
            val bundle = exportOf(state)

            assertExportGolden("$name/index.html", checkNotNull(bundle.html))
            assertExportGolden("$name/vibe-motion.css", bundle.css)
            bundle.js?.let { assertExportGolden("$name/vibe-motion.js", it) }
        }

        test("load only: golden bundle") {
            assertBundleGolden("load-only", LOAD_ONLY)

            val bundle = exportOf(LOAD_ONLY)
            bundle.js shouldBe null
            bundle.files.map { it.name } shouldBe listOf("index.html", "vibe-motion.css")
        }

        test("hover and in-view: golden bundle, with the script") {
            assertBundleGolden("hover-and-in-view", HOVER_AND_IN_VIEW)

            val bundle = exportOf(HOVER_AND_IN_VIEW)
            bundle.files.map { it.name } shouldBe listOf("index.html", "vibe-motion.css", "vibe-motion.js")
            // The committed copy is the file `packages/bridge` owns, so it cannot drift silently.
            bundle.js shouldBe InViewScript.source()
        }

        test("mixed catalog pins: golden bundle, no script needed") {
            assertBundleGolden("mixed-pins", MIXED_PINS)

            val bundle = exportOf(MIXED_PINS)
            bundle.js shouldBe null
            // 1.0.0 predates `fillMode`, so its shorthand still resets fill-mode to the initial.
            bundle.css shouldContain "animation: vm-underline-sweep-v1-0-0 500ms ease-out 0ms 1 normal none;"
            bundle.css shouldContain "animation: vm-fade-in-up-v1-1-0 600ms ease-out 0ms 1 normal both;"
        }

        test("exporting the same version twice gives the same bundle") {
            listOf(LOAD_ONLY, HOVER_AND_IN_VIEW, MIXED_PINS).forEach { state ->
                val (repositories, service) = projectWith(state)
                val request = ExportRequest(projectId = repositories.projectId)

                service.export(request) shouldBe service.export(request)
            }
        }
    })
