package dev.vibemotion.api.versions

import dev.vibemotion.api.catalog.ClasspathCatalogRepository
import dev.vibemotion.api.domain.Assignment
import dev.vibemotion.api.domain.Diff
import dev.vibemotion.api.domain.InvalidDiffException
import dev.vibemotion.api.domain.Trigger
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain

/**
 * A diff that does not resolve against the catalog is a version that can never be rendered or
 * exported, so it must never reach Postgres.
 */
class DiffValidatorTest :
    FunSpec({

        val catalog = ClasspathCatalogRepository.load()
        val validator = DiffValidator(catalog)
        val current = catalog.currentVersion

        fun assignment(
            animationId: String = "fade-in-up",
            catalogVersion: String = current,
            trigger: Trigger = Trigger.LOAD,
            params: Map<String, String> = mapOf("duration" to "600ms", "distance" to "24px"),
        ) = Assignment(animationId, catalogVersion, trigger, params)

        fun problemsOf(
            diff: Diff,
            catalogVersion: String = current,
        ): List<String> = shouldThrow<InvalidDiffException> { validator.validate(catalogVersion, diff) }.problems

        test("a diff that resolves against the catalog passes") {
            validator.validate(current, Diff(set = mapOf("vm-17" to assignment()), remove = listOf("vm-42")))
        }

        test("an empty diff is structurally valid (emptiness is a separate, 400-level rule)") {
            validator.validate(current, Diff.EMPTY)
        }

        test("the request's own catalogVersion must be published") {
            problemsOf(Diff(set = mapOf("vm-1" to assignment())), catalogVersion = "9.9.9")
                .single() shouldContain "catalogVersion '9.9.9' is not a published catalog version"
        }

        test("an assignment pinned to an unpublished catalog version is rejected") {
            problemsOf(Diff(set = mapOf("vm-1" to assignment(catalogVersion = "9.9.9"))))
                .single() shouldContain "catalogVersion '9.9.9'"
        }

        test("an animation that does not exist in the pinned version is rejected") {
            problemsOf(Diff(set = mapOf("vm-1" to assignment(animationId = "moonwalk"))))
                .single() shouldContain "animation 'moonwalk' does not exist"
        }

        test("a param the catalog entry does not declare is rejected") {
            problemsOf(Diff(set = mapOf("vm-1" to assignment(params = mapOf("duration" to "600ms", "wobble" to "3")))))
                .single() shouldContain "param 'wobble' is not declared"
        }

        test("a trigger the catalog entry does not allow is rejected") {
            problemsOf(Diff(set = mapOf("vm-1" to assignment(trigger = Trigger.HOVER))))
                .single() shouldContain "trigger 'hover' is not supported"
        }

        test("element ids must look like the ones the clone pipeline assigns") {
            problemsOf(Diff(set = mapOf("h1.hero" to assignment()))).single() shouldContain "'h1.hero' is not a valid element id"
            problemsOf(Diff(remove = listOf("vm-"))).single() shouldContain "'vm-' is not a valid element id"
        }

        test("every problem is reported at once, not one round trip at a time") {
            val problems =
                problemsOf(
                    Diff(
                        set =
                            mapOf(
                                "nope" to assignment(animationId = "moonwalk"),
                                "vm-2" to assignment(params = mapOf("wobble" to "3", "shimmy" to "4")),
                            ),
                        remove = listOf("also-nope"),
                    ),
                )

            problems shouldHaveSize 5
        }

        test("a diff over the entry cap is refused on the entry count alone") {
            // Short-circuits before per-entry validation: the whole point is that an oversized
            // diff costs one comparison, not two thousand catalog lookups and problem strings.
            val problems = problemsOf(Diff(remove = (1..MAX_DIFF_ENTRIES + 1).map { "not-a-vm-id-$it" }))

            problems shouldHaveSize 1
            problems.single() shouldContain "at most $MAX_DIFF_ENTRIES are allowed"
        }

        test("a diff exactly at the entry cap still validates normally") {
            val set = (1..MAX_DIFF_ENTRIES / 2).associate { "vm-$it" to assignment() }
            val remove = (1..MAX_DIFF_ENTRIES / 2).map { "vm-${it + MAX_DIFF_ENTRIES}" }

            validator.validate(current, Diff(set = set, remove = remove))
        }

        test("an assignment with more params than any animation declares is refused on the count") {
            val params = (1..MAX_PARAMS_PER_ASSIGNMENT + 1).associate { "p$it" to "600ms" }

            problemsOf(Diff(set = mapOf("vm-1" to assignment(params = params))))
                .single() shouldContain "at most $MAX_PARAMS_PER_ASSIGNMENT are allowed"
        }

        test("an element id longer than the cap is refused even though it matches the pattern") {
            val long = "vm-" + "9".repeat(MAX_VM_ID_LENGTH)

            problemsOf(Diff(remove = listOf(long))).single() shouldContain "at most $MAX_VM_ID_LENGTH are allowed"
        }

        test("a param value that does not match its declared type is rejected") {
            problemsOf(Diff(set = mapOf("vm-1" to assignment(params = mapOf("duration" to "600")))))
                .single() shouldContain "param 'duration' value '600' is not a valid duration"
        }

        test("a param value carrying a CSS injection payload is rejected") {
            // The reason this validator exists: the exporter emits param values as CSS on the
            // designer's own site, so a payload stored today is live CSS somewhere else later.
            val payload = "600ms; } body { background: url(https://evil.example.com/beacon)"

            problemsOf(Diff(set = mapOf("vm-1" to assignment(params = mapOf("duration" to payload)))))
                .single() shouldContain "param 'duration'"
        }

        test("a param value outside the catalog's declared range is rejected") {
            problemsOf(Diff(set = mapOf("vm-1" to assignment(params = mapOf("duration" to "9999ms")))))
                .single() shouldContain "maximum"
        }

        test("the exception message carries every problem, for the 422 body") {
            val failure = shouldThrow<InvalidDiffException> { validator.validate("9.9.9", Diff(remove = listOf("bad"))) }

            failure.problems shouldHaveSize 2
            (failure.message?.contains("; ") ?: false) shouldBe true
        }
    })
