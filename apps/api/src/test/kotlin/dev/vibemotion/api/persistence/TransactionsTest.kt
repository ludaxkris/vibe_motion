package dev.vibemotion.api.persistence

import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import java.sql.SQLException

/**
 * The lock timeout is only useful if it comes back as a retryable 503 rather than a 500, and the
 * driver's exception is always wrapped by the time it leaves Exposed.
 */
class TransactionsTest :
    FunSpec({

        fun lockTimeout() = SQLException("canceling statement due to lock timeout", "55P03")

        test("a lock timeout anywhere in the cause chain becomes a retryable project_busy") {
            val wrapped = RuntimeException("exposed wrapper", IllegalStateException("driver wrapper", lockTimeout()))

            val busy = wrapped.asProjectBusy().shouldNotBeNull()

            busy.retryAfterSeconds shouldBe 1
            (busy.message ?: "") shouldContain "retry"
        }

        test("any other SQL failure is left alone, so a bug never reads as a transient 503") {
            SQLException("null value in column violates not-null constraint", "23502").asProjectBusy() shouldBe null
            RuntimeException("boom").asProjectBusy() shouldBe null
        }

        test("a cyclic cause chain terminates instead of spinning") {
            val first = SQLException("first", "42P01")
            val second = SQLException("second", "42P01")
            first.initCause(second)
            second.initCause(first)

            first.asProjectBusy() shouldBe null
        }
    })
