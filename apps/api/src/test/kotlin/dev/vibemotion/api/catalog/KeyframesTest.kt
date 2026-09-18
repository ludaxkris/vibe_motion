package dev.vibemotion.api.catalog

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.shouldBe

/**
 * Kotlin counterpart of `packages/animation-catalog/test/catalog.test.ts`'s `keyframesName`
 * cases (DT-047: keyframes named by the full catalog version, not just the major).
 */
class KeyframesTest :
    FunSpec({

        test("embeds the full catalog version") {
            keyframesName("pulse", "1.4.2") shouldBe "vm-pulse-v1-4-2"
            keyframesName("pulse", "2.0.0") shouldBe "vm-pulse-v2-0-0"
            keyframesName("fade-in-up", "1.1.0") shouldBe "vm-fade-in-up-v1-1-0"
        }

        test("throws on a version that is not strict MAJOR.MINOR.PATCH") {
            shouldThrow<IllegalArgumentException> { keyframesName("pulse", "1.4") }
            shouldThrow<IllegalArgumentException> { keyframesName("pulse", "1.4.2-beta") }
            shouldThrow<IllegalArgumentException> { keyframesName("pulse", "v1.4.2") }
            shouldThrow<IllegalArgumentException> { keyframesName("pulse", "") }
        }

        test("is injective across versions that would collide under major-only naming") {
            val names =
                setOf(
                    keyframesName("pulse", "1.1.0"),
                    keyframesName("pulse", "11.0.0"),
                    keyframesName("pulse", "1.10.0"),
                )
            names.size shouldBe 3
        }
    })
