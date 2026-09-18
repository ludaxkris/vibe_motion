package dev.vibemotion.api.routes

import dev.vibemotion.api.domain.BodyTooLargeException
import io.ktor.http.HttpHeaders
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.receiveChannel
import io.ktor.utils.io.readAvailable
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.Json
import java.io.ByteArrayOutputStream

/**
 * The one place the JSON request body cap lives.
 *
 * 256 KB is roughly 1,300 assignments of ~200 bytes each in a single Save, which is far above a
 * page-level auto-generate, and small enough that buffering one per in-flight request cannot
 * threaten the heap the clone pipeline needs. The diff entry cap in
 * [dev.vibemotion.api.versions.DiffValidator] is the semantic half of the same rule; this is the
 * byte half, and it applies before anything is parsed.
 */
internal const val MAX_JSON_BODY_BYTES: Long = 256L * 1024

private const val CHUNK_BYTES = 8 * 1024

/** Unknown keys are a client bug, not something to swallow: they mean web and API disagree. */
private val requestJson = Json

/**
 * Reads the body as text, refusing anything over [limit].
 *
 * Both halves matter. `Content-Length` is checked first so an honest oversized request is refused
 * before a byte of it is read; the read itself is then capped as well, because a chunked body
 * carries no `Content-Length` and a lying one carries the wrong one. At no point is more than
 * [limit] bytes held.
 */
internal suspend fun ApplicationCall.receiveLimitedText(limit: Long = MAX_JSON_BODY_BYTES): String {
    request.headers[HttpHeaders.ContentLength]?.toLongOrNull()?.let { declared ->
        if (declared > limit) throw BodyTooLargeException(limit)
    }

    val channel = receiveChannel()
    val body = ByteArrayOutputStream(CHUNK_BYTES)
    val chunk = ByteArray(CHUNK_BYTES)
    var total = 0L
    while (true) {
        val read = channel.readAvailable(chunk, 0, chunk.size)
        if (read < 0) break
        if (read == 0) continue
        total += read
        if (total > limit) {
            val failure = BodyTooLargeException(limit)
            // Stop the sender rather than draining the rest of a body we have already refused.
            channel.cancel(failure)
            throw failure
        }
        body.write(chunk, 0, read)
    }
    return body.toString(Charsets.UTF_8)
}

/**
 * [receiveLimitedText] plus deserialisation.
 *
 * Used instead of `call.receive<T>()` on every route that accepts a body: ContentNegotiation reads
 * the whole body before it hands anything to a converter, which is precisely the buffering this
 * cap exists to prevent.
 */
internal suspend fun <T> ApplicationCall.receiveLimited(serializer: DeserializationStrategy<T>): T =
    requestJson.decodeFromString(serializer, receiveLimitedText())
