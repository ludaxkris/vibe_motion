package dev.vibemotion.api.clone

import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain

class BridgeAssetsTest :
    FunSpec({

        test("the bridge script is on the classpath and is loaded once") {
            val script = BridgeAssets.bridgeScript()

            script shouldContain "(function ()"
            BridgeAssets.bridgeScript() shouldBe script
        }

        test("announces the version the Kotlin side advertises") {
            BridgeAssets.bridgeScript() shouldContain """"${BridgeAssets.BRIDGE_VERSION}""""
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

        test("counts the elements the rewriter numbered, and blocks navigation in the capture phase") {
            val script = BridgeAssets.bridgeScript()

            script shouldContain "[data-vm-id]"
            script shouldContain "preventDefault"
            script shouldContain """document.addEventListener("""
        }
    })
