package dev.vibemotion.api.export

import io.kotest.matchers.shouldBe
import java.nio.file.Files
import java.nio.file.Path

private val GOLDEN_DIR = Path.of("src/test/resources/golden/export")

/**
 * Golden comparison for the exporter's output.
 *
 * Regenerate deliberately with `VM_UPDATE_GOLDEN=1 ./gradlew test` — the same switch the clone
 * goldens use — and then read the diff: a change here is a change to every page exported from now
 * on, on somebody else's site.
 */
internal fun assertExportGolden(
    name: String,
    actual: String,
) {
    val path = GOLDEN_DIR.resolve(name)
    if (System.getenv("VM_UPDATE_GOLDEN") == "1") {
        Files.createDirectories(path.parent)
        Files.writeString(path, actual)
    }
    actual shouldBe Files.readString(path)
}

/**
 * Specificity of the selector shapes the exporter emits, counted in the class column.
 *
 * Only what we write has to be handled: class selectors, `:hover`, `:not(.x)`, `:where(…)` and the
 * descendant combinator. There are no id or type selectors anywhere in an exported stylesheet, and
 * [CssEmitterTriggersTest] asserts that too.
 */
internal fun classSpecificity(selector: String): Int {
    // `:where()` contributes nothing at all, whatever is inside it. That is the whole point of
    // using it for the `.vm-js` gate: an `in-view` rule stays (0,1,0), the same as the preview's.
    val outsideWhere = Regex(""":where\([^()]*\)""").replace(selector, " ")
    val insideNot = Regex(""":not\(([^()]*)\)""").findAll(outsideWhere).sumOf { match -> match.groupValues[1].count { it == '.' } }
    val rest = Regex(""":not\([^()]*\)""").replace(outsideWhere, " ")
    return rest.count { it == '.' } + Regex(""":[a-z-]+""").findAll(rest).count() + insideNot
}

/** Every selector in the stylesheet, as written. */
internal fun selectorsIn(css: String): List<String> =
    css
        .lines()
        .map { it.trim() }
        .filter { it.endsWith(" {") && !it.startsWith("@") }
        .map { it.removeSuffix(" {") }
