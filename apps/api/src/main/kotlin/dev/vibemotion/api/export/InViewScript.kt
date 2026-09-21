package dev.vibemotion.api.export

/**
 * `vibe-motion.js`, read once from the jar and returned unchanged.
 *
 * The file itself is `packages/bridge/src/vibe-motion-export.js`, copied onto the classpath by the
 * `exportScriptResources` Gradle task, so the bytes the exporter hands a designer and the bytes
 * `packages/bridge`'s Playwright suite drives in a real browser are the same bytes.
 *
 * **Nothing is ever interpolated into it.** It is a constant, not a template: the class names it
 * uses are fixed, the threshold is a literal, and every value that varies per export is in the
 * stylesheet. That is what makes "the export's JavaScript" something a reviewer can read once.
 *
 * It is emitted only when some assignment uses the `in-view` trigger; `load` and `hover` are plain
 * CSS with no JavaScript at all.
 */
object InViewScript {
    private const val RESOURCE = "export/vibe-motion-export.js"

    private val script: String by lazy(::load)

    /** The file's text, byte for byte. */
    fun source(): String = script

    private fun load(): String =
        InViewScript::class.java.classLoader
            .getResourceAsStream(RESOURCE)
            ?.bufferedReader()
            ?.use { it.readText() }
            ?: throw IllegalStateException(
                "Missing export asset '$RESOURCE' — is exportScriptResources wired into processResources?",
            )
}
