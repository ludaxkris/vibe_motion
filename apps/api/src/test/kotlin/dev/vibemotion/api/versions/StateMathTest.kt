package dev.vibemotion.api.versions

import dev.vibemotion.api.domain.Assignment
import dev.vibemotion.api.domain.Diff
import dev.vibemotion.api.domain.State
import dev.vibemotion.api.domain.Trigger
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.ints.shouldBeLessThanOrEqual
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.bind
import io.kotest.property.arbitrary.enum
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.map
import io.kotest.property.arbitrary.of
import io.kotest.property.checkAll

private val vmIds = Arb.int(0..12).map { "vm-$it" }

private val assignments: Arb<Assignment> =
    Arb.bind(
        Arb.of("fade-in", "fade-in-up", "pulse"),
        Arb.of("1.0.0"),
        Arb.enum<Trigger>(),
        Arb.map(Arb.of("duration", "delay", "easing"), Arb.of("600ms", "0ms", "ease-out"), minSize = 0, maxSize = 3),
    ) { animationId, catalogVersion, trigger, params -> Assignment(animationId, catalogVersion, trigger, params) }

private val states: Arb<State> = Arb.map(vmIds, assignments, minSize = 0, maxSize = 6)

private val diffs: Arb<Diff> =
    Arb.bind(
        Arb.map(vmIds, assignments, minSize = 0, maxSize = 4),
        Arb.list(vmIds, 0..4),
    ) { set, remove -> Diff(set, remove.distinct()) }

private fun assignment(
    animationId: String = "fade-in-up",
    params: Map<String, String> = mapOf("duration" to "600ms"),
) = Assignment(animationId, "1.0.0", Trigger.LOAD, params)

/**
 * The laws the version history rests on. If any of these break, `stateAt` and restore stop
 * agreeing about what the user saved.
 */
class StateMathTest :
    FunSpec({

        test("applying the diff between two states turns the first into the second") {
            checkAll(states, states) { from, to ->
                applyDiff(from, diffBetween(from, to)) shouldBe to
            }
        }

        test("the diff between a state and itself is empty") {
            checkAll(states) { state ->
                diffBetween(state, state).isEmpty shouldBe true
            }
        }

        test("diffBetween is minimal: it sets only what changed and removes only what went away") {
            checkAll(states, states) { from, to ->
                val diff = diffBetween(from, to)
                diff.set.forEach { (vmId, assignment) -> (from[vmId] == assignment) shouldBe false }
                diff.remove.forEach { vmId ->
                    (vmId in from) shouldBe true
                    (vmId in to) shouldBe false
                }
            }
        }

        test("stateAt equals folding the diffs one at a time") {
            checkAll(Arb.list(diffs, 0..6)) { history ->
                var folded: State = emptyMap()
                history.forEach { folded = applyDiff(folded, it) }
                stateAt(history) shouldBe folded
            }
        }

        test("stateAt of no diffs is the empty state") {
            stateAt(emptyList()) shouldBe emptyMap()
        }

        test("removing an element that is not assigned is a no-op") {
            checkAll(states, vmIds) { state, vmId ->
                applyDiff(state, Diff(remove = listOf(vmId))) shouldBe state.filterKeys { it != vmId }
                applyDiff(state - vmId, Diff(remove = listOf(vmId))) shouldBe (state - vmId)
            }
        }

        test("setting and removing the same element in one diff leaves it removed") {
            checkAll(states, vmIds, assignments) { state, vmId, assignment ->
                val result = applyDiff(state, Diff(set = mapOf(vmId to assignment), remove = listOf(vmId)))
                (vmId in result) shouldBe false
            }
        }

        test("a diff set replaces an existing assignment rather than merging it") {
            val before = mapOf("vm-1" to assignment(params = mapOf("duration" to "600ms")))
            val after = applyDiff(before, Diff(set = mapOf("vm-1" to assignment(params = mapOf("delay" to "100ms")))))

            after["vm-1"]?.params shouldBe mapOf("delay" to "100ms")
        }

        test("three saves including a remove fold to the expected state") {
            val v1 = Diff(set = mapOf("vm-17" to assignment()))
            val v2 = Diff(set = mapOf("vm-42" to assignment("pulse")))
            val v3 = Diff(set = mapOf("vm-17" to assignment(params = mapOf("duration" to "900ms"))), remove = listOf("vm-42"))

            val state = stateAt(listOf(Diff.EMPTY, v1, v2, v3))

            state.keys shouldContainExactly setOf("vm-17")
            state["vm-17"]?.params shouldBe mapOf("duration" to "900ms")
        }

        test("statesAt agrees with folding each requested point independently") {
            // The law restore depends on: one pass that captures on the way through must give
            // exactly what two separate folds would, or a restore diff is computed against the
            // wrong "before".
            checkAll(Arb.list(diffs, 0..8), Arb.int(0..9), Arb.int(0..9)) { history, a, b ->
                val seqDiffs = history.mapIndexed { index, diff -> SeqDiff(index, diff) }

                val captured = statesAt(seqDiffs, setOf(a, b))

                captured[a] shouldBe stateAt(seqDiffs.filter { it.seq <= a }.map { it.diff })
                captured[b] shouldBe stateAt(seqDiffs.filter { it.seq <= b }.map { it.diff })
            }
        }

        test("statesAt returns one entry per requested seq, including past the end of history") {
            val history = listOf(SeqDiff(0, Diff.EMPTY), SeqDiff(1, Diff(set = mapOf("vm-1" to assignment()))))

            val captured = statesAt(history, setOf(0, 1, 99))

            captured.keys shouldContainExactly setOf(0, 1, 99)
            captured[0] shouldBe emptyMap()
            captured[1] shouldBe mapOf("vm-1" to assignment())
            // A seq past the end is the whole history folded, not a missing entry.
            captured[99] shouldBe captured[1]
        }

        test("statesAt of no requested points is empty, whatever the history") {
            statesAt(listOf(SeqDiff(0, Diff(set = mapOf("vm-1" to assignment())))), emptySet()) shouldBe emptyMap()
        }

        test("describeDiff names the animations it sets and the elements it removes") {
            val diff =
                Diff(
                    set = mapOf("vm-17" to assignment()),
                    remove = listOf("vm-42"),
                )

            describeDiff(diff) { "Fade In Up" } shouldBe "Fade In Up on vm-17, removed vm-42"
        }

        test("describeDiff falls back to the animation id when the catalog cannot name it") {
            describeDiff(Diff(set = mapOf("vm-1" to assignment()))) { null } shouldBe "fade-in-up on vm-1"
        }

        test("describeDiff of an empty diff reads as no changes") {
            describeDiff(Diff.EMPTY) { "Fade In Up" } shouldBe "No changes"
        }

        test("describeDiff summarises long diffs and never exceeds the label cap") {
            val many = (1..40).associate { "vm-$it" to assignment() }
            val label = describeDiff(Diff(set = many, remove = (100..140).map { "vm-$it" })) { "Fade In Up" }

            label.length shouldBeLessThanOrEqual 200
            label shouldBe
                "Fade In Up on vm-1, Fade In Up on vm-2, Fade In Up on vm-3, +37 more, " +
                "removed vm-100, vm-101, vm-102 +38 more"
        }

        test("describeDiff stays within the label cap for any diff") {
            checkAll(diffs) { diff ->
                describeDiff(diff) { "A".repeat(120) }.length shouldBeLessThanOrEqual 200
            }
        }
    })
