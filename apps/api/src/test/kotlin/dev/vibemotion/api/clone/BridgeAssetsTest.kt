package dev.vibemotion.api.clone

import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldMatch
import io.kotest.matchers.string.shouldNotContain
import io.kotest.matchers.string.shouldNotEndWith

/**
 * The script itself is `packages/bridge/src/vm-bridge.js`, copied into the jar by the
 * `bridgeResources` Gradle task and tested for real by that package's vitest and Playwright
 * suites. What is left for Kotlin is what only Kotlin can get wrong: that the file reaches the
 * classpath at all, that the version the service advertises is the one written in the script,
 * and that the two security properties the API's own CSP depends on still hold in the bytes it
 * serves.
 */
class BridgeAssetsTest :
    FunSpec({

        test("the bridge script is on the classpath and is loaded once") {
            val script = BridgeAssets.bridgeScript()

            script shouldContain "(function ()"
            BridgeAssets.bridgeScript() shouldBe script
        }

        test("the advertised version is parsed out of the script, not hand-synced") {
            val version = BridgeAssets.BRIDGE_VERSION

            version shouldMatch Regex("""\d+\.\d+\.\d+""")
            // The Phase 2 stub announced "0.1.0-stub"; the real protocol replaced it.
            version shouldNotEndWith "-stub"
            BridgeAssets.bridgeScript() shouldContain """BRIDGE_VERSION = "$version""""
        }

        test("the script on the classpath is the protocol bridge, not a stub") {
            val script = BridgeAssets.bridgeScript()

            // The whole shell -> iframe half of the protocol hangs off this one listener.
            script shouldContain """addEventListener("message""""
        }

        test("speaks the Phase 4 envelope and only to the configured parent origin") {
            val script = BridgeAssets.bridgeScript()

            script shouldContain """source: MESSAGE_SOURCE"""
            script shouldContain """"vibe-motion""""
            script shouldContain "vmParentOrigin"
            // A wildcard target origin would hand the cloned page to any embedder.
            script shouldNotContain """postMessage(message, "*")"""
            script shouldNotContain """, "*")"""
        }
    })
