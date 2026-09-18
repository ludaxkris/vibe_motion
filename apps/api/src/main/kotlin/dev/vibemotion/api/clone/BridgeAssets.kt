package dev.vibemotion.api.clone

/**
 * The bridge script, read once from the jar.
 *
 * It is a static asset rather than a generated string so it can be linted, diffed and reasoned
 * about as JavaScript, and so the `script-src 'self'` CSP that [BridgePageRenderer] sets holds:
 * the page loads it from this origin, it is never inlined into the document.
 */
object BridgeAssets {
    /** Where the route serves [bridgeScript]; also the default `src` [BridgePageRenderer] injects. */
    const val BRIDGE_PATH: String = "/bridge/vm-bridge.js"

    /** Announced by the script in its `ready` message, so the shell can detect a stale cache. */
    const val BRIDGE_VERSION: String = "0.1.0-stub"

    const val CONTENT_TYPE: String = "application/javascript; charset=utf-8"

    private const val RESOURCE = "bridge/vm-bridge.js"

    private val script: String by lazy(::load)

    fun bridgeScript(): String = script

    private fun load(): String =
        BridgeAssets::class.java.classLoader
            .getResourceAsStream(RESOURCE)
            ?.bufferedReader()
            ?.use { it.readText() }
            ?: throw IllegalStateException("Missing bridge asset '$RESOURCE'")
}
