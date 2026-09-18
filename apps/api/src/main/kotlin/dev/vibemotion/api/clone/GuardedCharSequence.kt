package dev.vibemotion.api.clone

/**
 * A view of [text] that checks the clone's deadline while a regex engine reads it.
 *
 * `java.util.regex` is a backtracking engine: a pattern that is linear on ordinary input can be
 * quadratic or worse on input built to hurt it, and a running match cannot be interrupted. Twice
 * in review a pattern over fetched CSS turned out to have such a shape after being "fixed". Rather
 * than rely on every pattern being perfect forever, every regex over fetched CSS, which is where
 * the input is large and attacker-shaped, reads it through this class: the engine calls [get] for
 * each character it examines, so however bad the pattern, the work stops with
 * [CloneException.Unreachable] once the budget is spent.
 *
 * Deliberately NOT guarded, each linear by construction and each on small input: `WHITESPACE`
 * (one greedy class) in HtmlRewriter, and the two charset sniffers in PageFetcher (a header value,
 * and the first 2048 characters of a document). If you add a regex over fetched content, guard it.
 *
 * The check runs once per [CHECK_INTERVAL] reads, so the cost on honest input is one increment
 * and one mask per character.
 */
internal class GuardedCharSequence(
    private val text: CharSequence,
    private val deadline: DeadlineCheck,
) : CharSequence {
    private var reads = 0

    override val length: Int get() = text.length

    override fun get(index: Int): Char {
        if (++reads and CHECK_MASK == 0) deadline.check()
        return text[index]
    }

    override fun subSequence(
        startIndex: Int,
        endIndex: Int,
    ): CharSequence = GuardedCharSequence(text.subSequence(startIndex, endIndex), deadline)

    override fun toString(): String = text.toString()

    private companion object {
        const val CHECK_INTERVAL = 4096
        const val CHECK_MASK = CHECK_INTERVAL - 1
    }
}
