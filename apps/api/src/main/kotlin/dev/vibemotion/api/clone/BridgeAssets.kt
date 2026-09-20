package dev.vibemotion.api.clone

/**
 * The bridge script, read once from the jar.
 *
 * The file itself lives in `packages/bridge/src/vm-bridge.js` and is copied onto the classpath by
 * the `bridgeResources` Gradle task (see `build.gradle.kts`), so the API, the web app's mock page
 * route and the package's own test suites all serve the same bytes. It is a static asset rather
 * than a generated string so it can be linted, diffed and reasoned about as JavaScript, and so the
 * `script-src 'self'` CSP that [BridgePageRenderer] sets holds: the page loads it from this origin,
 * it is never inlined into the document.
 */
object BridgeAssets {
    /** Where the route serves [bridgeScript]; also the default `src` [BridgePageRenderer] injects. */
    const val BRIDGE_PATH: String = "/bridge/vm-bridge.js"

    const val CONTENT_TYPE: String = "application/javascript; charset=utf-8"

    private const val RESOURCE = "bridge/vm-bridge.js"

    /**
     * The script declares its version on one line the way `packages/bridge/test/protocol.test.ts`
     * asserts it does, which is what lets this be parsed rather than hand-synced: a Kotlin constant
     * would be a second place to remember, and the failure mode — a shell told the wrong version by
     * a service that never noticed — is silent.
     */
    private val VERSION_PATTERN = Regex("""BRIDGE_VERSION\s*=\s*"([^"]+)"""")

    private val script: String by lazy(::load)

    /** Announced by the script in its `ready` message, so the shell can detect a stale cache. */
    val BRIDGE_VERSION: String by lazy { parseVersion(script) }

    fun bridgeScript(): String = script

    private fun load(): String =
        BridgeAssets::class.java.classLoader
            .getResourceAsStream(RESOURCE)
            ?.bufferedReader()
            ?.use { it.readText() }
            ?: throw IllegalStateException("Missing bridge asset '$RESOURCE'")

    private fun parseVersion(source: String): String =
        VERSION_PATTERN.find(source)?.groupValues?.getOrNull(1)
            ?: throw IllegalStateException(
                "Bridge asset '$RESOURCE' declares no BRIDGE_VERSION; " +
                    "packages/bridge/src/vm-bridge.js must keep it on one parseable line",
            )
}
