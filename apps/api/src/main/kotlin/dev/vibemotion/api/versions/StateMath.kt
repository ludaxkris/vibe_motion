package dev.vibemotion.api.versions

import dev.vibemotion.api.domain.Assignment
import dev.vibemotion.api.domain.Diff
import dev.vibemotion.api.domain.State

/*
 * The arithmetic of version history. Pure functions over [State] and [Diff]: no database, no
 * catalog, no clock. Everything that materialises or compares project state goes through here, so
 * the versions endpoints, restore and (later) the exporter cannot disagree about what a diff means.
 *
 * A diff is applied `set` first, then `remove`: setting and removing the same element in one diff
 * leaves it removed.
 */

/** A version's diff together with its position in history. Persistence-free, like the rest of this file. */
data class SeqDiff(
    val seq: Int,
    val diff: Diff,
)

/** [state] with [diff] applied. Removing an element that is not in [state] is a no-op. */
fun applyDiff(
    state: State,
    diff: Diff,
): State {
    if (diff.isEmpty) return state
    val next = LinkedHashMap(state)
    next.putAll(diff.set)
    diff.remove.forEach { next.remove(it) }
    return next
}

/** Folds [diffs] (v0 first, in `seq` order) over the empty state. */
fun stateAt(diffs: List<Diff>): State = diffs.fold(emptyMap()) { state, diff -> applyDiff(state, diff) }

/**
 * The state at each of [seqs], from a single pass over [diffs].
 *
 * Restore needs two states — the one it is leaving and the one it is reproducing — and used to
 * fold history twice to get them, while holding the project row lock. History is linear and both
 * states lie on the same path, so one pass that captures on the way through is exactly equivalent:
 * `statesAt(diffs, setOf(a, b))[a] == stateAt(diffs.filter { it.seq <= a }.map { it.diff })`.
 *
 * @param diffs v0 first, ascending by `seq`.
 * @param seqs the positions to capture. A position with no diff of its own captures the state
 *   after every earlier diff, so a caller cannot get a surprise by asking about a gap or a seq
 *   past the end.
 * @return one entry per requested seq, always.
 */
fun statesAt(
    diffs: List<SeqDiff>,
    seqs: Set<Int>,
): Map<Int, State> {
    val wanted = seqs.sorted()
    val captured = LinkedHashMap<Int, State>(wanted.size)
    var state: State = emptyMap()
    var next = 0

    diffs.forEach { (seq, diff) ->
        while (next < wanted.size && wanted[next] < seq) {
            captured[wanted[next]] = state
            next++
        }
        state = applyDiff(state, diff)
        while (next < wanted.size && wanted[next] == seq) {
            captured[wanted[next]] = state
            next++
        }
    }
    while (next < wanted.size) {
        captured[wanted[next]] = state
        next++
    }
    return captured
}

/**
 * The minimal diff that turns [from] into [to].
 *
 * `set` carries only the elements [to] adds or changes; `remove` only the elements [from] has and
 * [to] does not. `applyDiff(from, diffBetween(from, to)) == to` for any pair of states.
 */
fun diffBetween(
    from: State,
    to: State,
): Diff =
    Diff(
        set = to.filterNot { (vmId, assignment) -> from[vmId] == assignment },
        remove = from.keys.filterNot { it in to },
    )

private const val MAX_LABEL_LENGTH = 200
private const val MAX_LISTED = 3

/**
 * A one-line human label for [diff], used when a Save arrives without one — for example
 * `Fade In Up on vm-17, removed vm-42`.
 *
 * [animationName] resolves an assignment to its catalog display name; it returns null when the
 * assignment pins a version this build does not have, in which case the raw `animationId` is used.
 * The result is never longer than 200 characters (the contract's `label` cap).
 */
fun describeDiff(
    diff: Diff,
    animationName: (Assignment) -> String?,
): String {
    if (diff.isEmpty) return "No changes"

    val parts = mutableListOf<String>()
    diff.set.entries.take(MAX_LISTED).forEach { (vmId, assignment) ->
        parts += "${animationName(assignment) ?: assignment.animationId} on $vmId"
    }
    if (diff.set.size > MAX_LISTED) {
        parts += "+${diff.set.size - MAX_LISTED} more"
    }
    if (diff.remove.isNotEmpty()) {
        val listed = diff.remove.take(MAX_LISTED).joinToString(", ")
        val rest = if (diff.remove.size > MAX_LISTED) " +${diff.remove.size - MAX_LISTED} more" else ""
        parts += "removed $listed$rest"
    }

    val label = parts.joinToString(", ")
    return if (label.length <= MAX_LABEL_LENGTH) label else label.take(MAX_LABEL_LENGTH - 1) + "…"
}
