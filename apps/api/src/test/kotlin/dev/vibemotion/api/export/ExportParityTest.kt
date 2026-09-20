package dev.vibemotion.api.export

import dev.vibemotion.api.catalog.keyframesName
import dev.vibemotion.api.domain.Trigger
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
private data class ParityCase(
    val variant: String,
    val params: Map<String, String>,
    val longhands: Map<String, String>,
    val customProperties: Map<String, String>,
)

@Serializable
private data class ParityEntry(
    val version: String,
    val animationId: String,
    val keyframesCss: String,
    val baseStyles: Map<String, String>,
    val cases: List<ParityCase>,
)

@Serializable
private data class ParityFixture(
    val generator: String,
    val entries: List<ParityEntry>,
)

private val parityJson = Json { ignoreUnknownKeys = true }

/** CSS initial values for the longhands the shorthand resets, in shorthand order after the name. */
private val INITIAL_LONGHANDS =
    listOf(
        "animation-duration" to "0s",
        "animation-timing-function" to "ease",
        "animation-delay" to "0s",
        "animation-iteration-count" to "1",
        "animation-direction" to "normal",
        "animation-fill-mode" to "none",
    )

/**
 * The editor preview renders CSS from TypeScript (`apps/web/lib/runtime-css`); the export renders
 * it from Kotlin. A designer who exports must get what the designer saw, so the two generators are
 * held to one shared artefact: `export-parity.json`, produced by the TypeScript side's own vitest
 * run for **every** published `(catalogVersion, animationId)` pair, in three param cases each.
 *
 * This reads the committed file off the test classpath (`exportParityResources` in
 * `build.gradle.kts`) and drives the real [CssEmitter] against it — the emitted bytes, parsed back,
 * not an internal shortcut.
 *
 * Triggers are not in the fixture: TypeScript has no trigger CSS. The real-browser specs in
 * `packages/bridge/e2e` and the full-stack spec in `apps/e2e/web/stack` cover those.
 */
class ExportParityTest :
    FunSpec({

        val fixtureJson =
            checkNotNull(
                ExportParityTest::class.java.classLoader.getResourceAsStream("export/export-parity.json"),
            ) {
                "Missing export/export-parity.json on the test classpath. Generate it with " +
                    "`VM_UPDATE_PARITY=1 pnpm --filter web test export-parity` and check that " +
                    "exportParityResources is wired into the test source set."
            }.bufferedReader()
                .use { it.readText() }
        val fixture = parityJson.decodeFromString(ParityFixture.serializer(), fixtureJson)

        val emitter = CssEmitter(CATALOG)

        test("the fixture covers exactly the published (version, animationId) pairs") {
            val published =
                CATALOG.versions().flatMap { version ->
                    CATALOG
                        .catalog(version)
                        ?.entries
                        .orEmpty()
                        .map { "$version/${it.id}" }
                }

            fixture.entries.map { "${it.version}/${it.animationId}" } shouldContainExactly published
            published.size shouldBeGreaterThan 0
        }

        test("every keyframes block is byte-identical to the preview's") {
            fixture.entries.forEach { entry ->
                val emitted = emitter.snippet(VERSION_5, "vm-1", entry.assignment())

                withClue("${entry.version}/${entry.animationId}") {
                    entry.keyframesCss shouldBe "@keyframes ${keyframesName(entry.animationId, entry.version)} { ${entry.body()} }"
                    emitted.lines().first { it.startsWith("@keyframes") } shouldBe entry.keyframesCss
                }
            }
        }

        test("custom properties match in value and in order") {
            fixture.entries.forEach { entry ->
                entry.cases.forEach { case ->
                    val emitted = emitter.snippet(VERSION_5, "vm-1", entry.assignment(case.params))
                    val properties =
                        emitted
                            .lines()
                            .map { it.trim().removeSuffix(";") }
                            .filter { it.startsWith("--") }
                            .associate { line -> line.substringBefore(":") to line.substringAfter(": ") }

                    withClue("${entry.version}/${entry.animationId} (${case.variant})") {
                        properties.keys.toList() shouldContainExactly case.customProperties.keys.toList()
                        properties shouldBe case.customProperties
                    }
                }
            }
        }

        test("Kotlin's split of the verbatim base styles equals TypeScript's parsed map, with no duplicate property") {
            fixture.entries.forEach { entry ->
                val declarations = entry.rawBaseStyles()

                withClue("${entry.version}/${entry.animationId}") {
                    parseDeclarations(declarations) shouldBe entry.baseStyles
                    // A repeated property would make the map smaller than the declaration list.
                    declarations.split(";").count { it.contains(":") } shouldBe entry.baseStyles.size
                }
            }
        }

        test("the shorthand, expanded back to longhands, equals the preview's with the absent ones at their initial values") {
            fixture.entries.forEach { entry ->
                entry.cases.forEach { case ->
                    val emitted = emitter.snippet(VERSION_5, "vm-1", entry.assignment(case.params))
                    val expanded = expandShorthand(shorthandIn(emitted))
                    val expected = INITIAL_LONGHANDS.toMap() + case.longhands

                    withClue("${entry.version}/${entry.animationId} (${case.variant})") {
                        expanded shouldBe expected
                    }
                }
            }
        }

        test("the fixture is not vacuous: every entry carries three cases and the 'all' case moves something") {
            fixture.entries.forEach { entry ->
                withClue("${entry.version}/${entry.animationId}") {
                    entry.cases.map { it.variant } shouldContainExactly listOf("defaults", "all", "partial")
                    val (defaults, all) = entry.cases
                    (all.longhands != defaults.longhands || all.customProperties != defaults.customProperties) shouldBe true
                }
            }
        }
    })

/** The assignment the fixture case describes, on whatever trigger the entry supports. */
private fun ParityEntry.assignment(params: Map<String, String> = emptyMap()) =
    dev.vibemotion.api.domain.Assignment(
        animationId = animationId,
        catalogVersion = version,
        trigger = Trigger.LOAD,
        params = params,
    )

private fun ParityEntry.catalogEntry() =
    checkNotNull(CATALOG.catalog(version)?.entries?.firstOrNull { it.id == animationId }) {
        "The fixture lists $version/$animationId but the bundled catalog does not have it"
    }

private fun ParityEntry.body() = catalogEntry().keyframes

private fun ParityEntry.rawBaseStyles() = catalogEntry().baseStyles.orEmpty()

/**
 * `name duration timing-function delay iteration-count direction fill-mode` back into a longhand
 * map. Split on top-level spaces, because `cubic-bezier(0.16, 1, 0.3, 1)` contains several.
 */
private fun expandShorthand(shorthand: String): Map<String, String> {
    val parts = splitOnTopLevelSpaces(shorthand)
    check(parts.size == INITIAL_LONGHANDS.size + 1) { "Expected 7 shorthand components, got ${parts.size} in '$shorthand'" }
    return buildMap {
        put("animation-name", parts[0])
        INITIAL_LONGHANDS.forEachIndexed { index, (property, _) -> put(property, parts[index + 1]) }
    }
}

private fun splitOnTopLevelSpaces(value: String): List<String> {
    val parts = mutableListOf<String>()
    var depth = 0
    val current = StringBuilder()
    value.forEach { character ->
        when {
            character == '(' -> {
                depth++
                current.append(character)
            }

            character == ')' -> {
                depth--
                current.append(character)
            }

            character == ' ' && depth == 0 -> {
                if (current.isNotEmpty()) parts += current.toString()
                current.clear()
            }

            else -> {
                current.append(character)
            }
        }
    }
    if (current.isNotEmpty()) parts += current.toString()
    return parts
}
