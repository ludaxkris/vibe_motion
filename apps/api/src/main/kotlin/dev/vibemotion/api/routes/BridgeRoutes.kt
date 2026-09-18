package dev.vibemotion.api.routes

import dev.vibemotion.api.clone.BridgeAssets
import dev.vibemotion.api.model.ifNoneMatch
import dev.vibemotion.api.model.strongETag
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.header
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.get

/**
 * The content hash of the script this build serves. The asset is read once from the jar, so this
 * is computed once and can never go stale within a process.
 */
private val bridgeETag: String by lazy { strongETag(BridgeAssets.BRIDGE_VERSION, BridgeAssets.bridgeScript()) }

/**
 * Serves the bridge script the rendered project page loads (`script-src 'self'`).
 *
 * `no-cache` plus a content ETag rather than a short `max-age`: the bridge evolves with the editor
 * (Phase 4+) and a stale bridge talking to a newer shell is worse than a conditional request per
 * page view — but a `max-age` without a validator cannot revalidate at all, so every expiry was a
 * full download. Now an unchanged bridge costs a 304.
 */
fun Route.bridgeRoutes() {
    get(BridgeAssets.BRIDGE_PATH) {
        call.response.header(HttpHeaders.CacheControl, "no-cache")
        call.response.header(HttpHeaders.ETag, bridgeETag)
        if (ifNoneMatch(call.request.header(HttpHeaders.IfNoneMatch), bridgeETag)) {
            call.respond(HttpStatusCode.NotModified)
            return@get
        }
        call.respondText(BridgeAssets.bridgeScript(), ContentType.parse(BridgeAssets.CONTENT_TYPE))
    }
}
