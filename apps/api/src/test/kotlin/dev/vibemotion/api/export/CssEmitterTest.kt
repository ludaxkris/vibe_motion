package dev.vibemotion.api.export

import dev.vibemotion.api.catalog.CatalogRepository
import dev.vibemotion.api.catalog.ClasspathCatalogRepository
import dev.vibemotion.api.domain.Assignment
import dev.vibemotion.api.domain.State
import dev.vibemotion.api.domain.Trigger
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import io.kotest.property.Arb
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.map
import io.kotest.property.checkAll
import java.time.OffsetDateTime

internal val CATALOG: CatalogRepository = ClasspathCatalogRepository.load()

internal val SAVED_AT: OffsetDateTime = OffsetDateTime.parse("2026-09-20T23:30:00+02:00")
internal val VERSION_5 = ExportVersion(seq = 5, createdAt = SAVED_AT)

internal fun assignment(
    animationId: String = "fade-in-up",
    catalogVersion: String = "1.1.0",
    trigger: Trigger = Trigger.LOAD,
    params: Map<String, String> = emptyMap(),
) = Assignment(animationId = animationId, catalogVersion = catalogVersion, trigger = trigger, params = params)

/** The `animation` shorthand of the first (and usually only) rule that has one. */
internal fun shorthandIn(css: String): String =
    css
        .lines()
        .first { it.trim().startsWith("animation:") }
        .trim()
        .removePrefix("animation:")
        .trim()
        .removeSuffix(";")

class CssEmitterTest :
    FunSpec({

        val emitter = CssEmitter(CATALOG)

        fun stylesheet(state: State) = emitter.stylesheet(VERSION_5, state)

        test("the shorthand is name duration timing-function delay iteration-count direction fill-mode") {
            val css = stylesheet(mapOf("vm-17" to assignment()))

            shorthandIn(css) shouldBe "vm-fade-in-up-v1-1-0 600ms ease-out 0ms 1 normal both"
        }

        test("a standard param the pinned entry does not declare is written at its CSS initial value") {
            // Catalog 1.0.0 predates `fillMode`, and `fade-in-up` declares no iteration or
            // direction in either version. The shorthand still resets every longhand, so a host
            // rule cannot retime our animation.
            val css = stylesheet(mapOf("vm-1" to assignment(catalogVersion = "1.0.0")))

            shorthandIn(css) shouldBe "vm-fade-in-up-v1-0-0 600ms ease-out 0ms 1 normal none"
        }

        test("an entry that declares every standard key writes every one of them") {
            val css = stylesheet(mapOf("vm-1" to assignment(animationId = "spin", trigger = Trigger.LOAD)))

            shorthandIn(css) shouldBe "vm-spin-v1-1-0 2000ms linear 0ms infinite normal none"
        }

        test("a param the assignment sets wins, and one it omits takes the catalog default") {
            val css =
                stylesheet(
                    mapOf("vm-1" to assignment(params = mapOf("duration" to "1200ms", "distance" to "48px"))),
                )

            shorthandIn(css) shouldBe "vm-fade-in-up-v1-1-0 1200ms ease-out 0ms 1 normal both"
            css shouldContain "--vm-distance: 48px;"
        }

        test("a params key the entry does not declare is dropped, exactly as the preview drops it") {
            val css = stylesheet(mapOf("vm-1" to assignment(params = mapOf("notAParam" to "9px"))))

            css shouldNotContain "notAParam"
            css shouldNotContain "9px"
        }

        test("custom properties come out in catalog param order") {
            val css = stylesheet(mapOf("vm-1" to assignment(animationId = "glow", trigger = Trigger.LOAD)))
            val properties = css.lines().filter { it.trim().startsWith("--vm-") }.map { it.trim() }

            properties shouldContainExactly listOf("--vm-color: rgba(99, 102, 241, 0.6);", "--vm-radius: 16px;")
        }

        test("base styles come first, then the custom properties, then the animation") {
            val css = stylesheet(mapOf("vm-1" to assignment(animationId = "scale-in", trigger = Trigger.LOAD)))
            val body =
                css
                    .substringAfter(".vm-a1 {")
                    .substringBefore("}")
                    .trim()
                    .lines()
                    .map { it.trim() }

            body shouldContainExactly
                listOf(
                    "transform-origin: center;",
                    "--vm-from-scale: 0.8;",
                    "animation: vm-scale-in-v1-1-0 500ms cubic-bezier(0.16, 1, 0.3, 1) 0ms 1 normal both;",
                )
        }

        test("base styles are emitted verbatim, so a multi-declaration list stays one line") {
            val css = stylesheet(mapOf("vm-1" to assignment(animationId = "underline-sweep", trigger = Trigger.LOAD)))
            val entry = CATALOG.catalog("1.1.0")?.entries?.first { it.id == "underline-sweep" }

            css shouldContain "    ${entry?.baseStyles}\n"
        }

        test("keyframes are emitted once per distinct name, in first-use order, outside the media query") {
            val css =
                stylesheet(
                    linkedMapOf(
                        "vm-1" to assignment(animationId = "scale-in"),
                        "vm-2" to assignment(animationId = "fade-in-up"),
                        // The same animation again: no second block.
                        "vm-3" to assignment(animationId = "scale-in"),
                    ),
                )
            val names = Regex("""@keyframes (\S+) \{""").findAll(css).map { it.groupValues[1] }.toList()

            names shouldContainExactly listOf("vm-scale-in-v1-1-0", "vm-fade-in-up-v1-1-0")
            // Every @keyframes sits before the media query, so an unused one stays inert.
            (css.lastIndexOf("@keyframes ") < css.indexOf("@media (prefers-reduced-motion")) shouldBe true
        }

        test("the same animation pinned to two catalog versions is two keyframes blocks") {
            val css =
                stylesheet(
                    linkedMapOf(
                        "vm-1" to assignment(catalogVersion = "1.0.0"),
                        "vm-2" to assignment(catalogVersion = "1.1.0"),
                    ),
                )

            css shouldContain "@keyframes vm-fade-in-up-v1-0-0 {"
            css shouldContain "@keyframes vm-fade-in-up-v1-1-0 {"
            css.split("@keyframes").size - 1 shouldBe 2
        }

        test("a keyframes block is byte-identical to the preview's, body included") {
            val entry = checkNotNull(CATALOG.catalog("1.1.0")?.entries?.first { it.id == "fade-in-up" })

            stylesheet(mapOf("vm-1" to assignment())) shouldContain
                "@keyframes vm-fade-in-up-v1-1-0 { ${entry.keyframes} }"
        }

        test("the header carries the format, the version seq, the saved date in UTC and the catalog pins") {
            val css =
                stylesheet(
                    linkedMapOf(
                        "vm-1" to assignment(catalogVersion = "1.1.0"),
                        "vm-2" to assignment(catalogVersion = "1.0.0"),
                    ),
                )

            // 2026-09-20T23:30+02:00 is 21:30 UTC on the same day; the date is the UTC one.
            css.lines().first() shouldBe "/* Vibe Motion · format 1 · v5 · saved 2026-09-20 (UTC) · catalog 1.0.0, 1.1.0 */"
        }

        test("a version saved just after midnight in its own zone reports the UTC date") {
            val justAfterMidnight = ExportVersion(seq = 2, createdAt = OffsetDateTime.parse("2026-09-21T00:30:00+02:00"))

            emitter.stylesheet(justAfterMidnight, mapOf("vm-1" to assignment())).lines().first() shouldContain
                "saved 2026-09-20 (UTC)"
        }

        test("the header never carries a label, a title or a URL") {
            val css = stylesheet(mapOf("vm-1" to assignment()))
            val header = css.lines().first()

            header shouldNotContain "http"
            header shouldNotContain "vm-a1"
        }

        test("a version with no assignments is a header and nothing else") {
            val css = stylesheet(emptyMap())

            css shouldBe "/* Vibe Motion · format 1 · v5 · saved 2026-09-20 (UTC) */\n"
        }

        test("the id in the keyframes name comes from the resolved entry, never from the stored string") {
            // DT-069: `keyframesName` validates the version but not the id, so the exporter
            // resolves the entry first and names the rule from `entry.id`.
            val css = stylesheet(mapOf("vm-1" to assignment(animationId = "FADE-IN-UP")))

            css shouldContain "@keyframes vm-fade-in-up-v1-1-0 {"
            css shouldNotContain "FADE-IN-UP"
        }

        test("an assignment whose pinned catalog version is not published fails the export") {
            val error =
                shouldThrow<ExportIntegrityException> {
                    stylesheet(mapOf("vm-1" to assignment(catalogVersion = "9.9.9")))
                }

            error.message.orEmpty() shouldContain "vm-1"
        }

        test("an assignment whose animation is not in the pinned catalog fails the export") {
            shouldThrow<ExportIntegrityException> {
                stylesheet(mapOf("vm-1" to assignment(animationId = "no-such-animation")))
            }
        }

        test("a stored param value that no longer validates fails the export rather than reaching the CSS") {
            val error =
                shouldThrow<ExportIntegrityException> {
                    stylesheet(mapOf("vm-17" to assignment(params = mapOf("distance" to "24px; } body { display: none"))))
                }

            error.message.orEmpty() shouldContain "vm-17"
            error.message.orEmpty() shouldContain "distance"
        }

        test("a failure never repeats the value it refused") {
            val error =
                shouldThrow<ExportIntegrityException> {
                    stylesheet(mapOf("vm-17" to assignment(params = mapOf("distance" to "24px; } body { display: none"))))
                }

            error.message.orEmpty() shouldNotContain "display"
            error.message.orEmpty() shouldNotContain "24px"
        }

        test("no catalog entry's keyframes or base styles could break out of the stylesheet") {
            CATALOG.versions().forEach { version ->
                CATALOG.catalog(version)?.entries?.forEach { entry ->
                    listOf("keyframes" to entry.keyframes, "baseStyles" to entry.baseStyles.orEmpty()).forEach { (field, body) ->
                        withClue("$version/${entry.id}.$field") {
                            listOf("<", "</style", "@", "\\", "/*", "*/").forEach { forbidden ->
                                body shouldNotContain forbidden
                            }
                            body.count { it == '{' } shouldBe body.count { it == '}' }
                        }
                    }
                    withClue("$version/${entry.id}.baseStyles") {
                        parseDeclarations(entry.baseStyles.orEmpty()).keys.forEach { property ->
                            property.startsWith("animation") shouldBe false
                            property.startsWith("--vm-") shouldBe false
                        }
                    }
                }
            }
        }

        test("the same state always produces the same bytes, and one rule group per assignment") {
            checkAll(30, states()) { state ->
                val first = stylesheet(state)
                val second = stylesheet(state)

                second shouldBe first
                first.count { it == '{' } shouldBe first.count { it == '}' }

                val lines = first.lines().map { it.trim() }
                // One `animation` shorthand per assignment, whatever the trigger. The hold rule
                // writes longhands, so it is not counted here.
                lines.count { it.startsWith("animation:") } shouldBe state.size
                // One group comment per assignment, plus one for the hold rule when it is present.
                Trigger.entries.forEach { trigger ->
                    val expected =
                        state.values.count { it.trigger == trigger } +
                            if (trigger == Trigger.IN_VIEW && state.values.any { it.trigger == trigger }) 1 else 0
                    withClue(trigger.name) { lines.count { it.startsWith("/* ${trigger.wire()}") } shouldBe expected }
                }
                // Every assignment's class reaches a selector, exactly once per rule that needs it.
                state.keys.forEach { vmId ->
                    withClue(vmId) { first shouldContain ".${elementClass(vmId)}" }
                }
            }
        }

        test("no exported stylesheet ever carries !important") {
            checkAll(20, states()) { state ->
                stylesheet(state) shouldNotContain "!important"
            }
        }
    })

/** The trigger as it is written in a stylesheet comment and on the wire. */
internal fun Trigger.wire(): String =
    when (this) {
        Trigger.LOAD -> "load"
        Trigger.HOVER -> "hover"
        Trigger.IN_VIEW -> "in-view"
    }

/** Arbitrary states built from real catalog entries, with their real triggers. */
internal fun states(): Arb<State> {
    val pairs =
        CATALOG.versions().flatMap { version ->
            CATALOG.catalog(version)?.entries.orEmpty().flatMap { entry ->
                entry.triggers.map { Triple(version, entry.id, it) }
            }
        }
    val assignments =
        Arb.element(pairs).map { (version, id, trigger) ->
            Assignment(
                animationId = id,
                catalogVersion = version,
                trigger = Trigger.entries.first { it.name.replace("_", "-").equals(trigger.name.replace("_", "-"), true) },
                params = emptyMap(),
            )
        }
    return Arb.map(Arb.int(1..24).map { "vm-$it" }, assignments, minSize = 0, maxSize = 8)
}
