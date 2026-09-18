package dev.vibemotion.api.clone

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.longs.shouldBeLessThan
import io.kotest.matchers.shouldBe
import kotlin.system.measureTimeMillis

class GuardedCharSequenceTest :
    FunSpec({

        test("behaves as the text it wraps") {
            val guarded = GuardedCharSequence("hello world", DeadlineCheck.NONE)
            guarded.length shouldBe 11
            guarded[4] shouldBe 'o'
            guarded.subSequence(startIndex = 6, endIndex = 11).toString() shouldBe "world"
            guarded.toString() shouldBe "hello world"
            Regex("o").replace(guarded, "0") shouldBe "hell0 w0rld"
        }

        test("a quadratic regex is cut off at the deadline instead of running for minutes") {
            // Not a textbook pattern: JDK 21 memoises (a+)+$ and friends. This is the real shape that
            // shipped in review, two whitespace runs around an atom that can match empty, on the
            // input that cost ~160 s. Unguarded it cannot be interrupted at all.
            val quadratic = Regex("""url\(\s*["']?\s*(?:javascript|vbscript)""")
            val input = "url(" + " ".repeat(200_000)
            val stopAt = System.nanoTime() + 200_000_000L
            val deadline =
                DeadlineCheck {
                    if (System.nanoTime() > stopAt) throw CloneException.Unreachable("clone timed out")
                }

            val elapsed =
                measureTimeMillis {
                    shouldThrow<CloneException.Unreachable> {
                        quadratic.containsMatchIn(GuardedCharSequence(input, deadline))
                    }
                }

            withClue("took ${elapsed}ms") { elapsed shouldBeLessThan 5_000L }
        }
    })
