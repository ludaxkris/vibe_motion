package dev.vibemotion.api.routes

import dev.vibemotion.api.clone.BridgeAssets
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.server.response.header
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.get

/**
 * Serves the bridge script the rendered project page loads (`script-src 'self'`).
 *
 * Short cache with revalidation: the bridge evolves with the editor (Phase 4+), and a stale
 * bridge talking to a newer shell is worse than one extra conditional request per page view.
 */
fun Route.bridgeRoutes() {
    get(BridgeAssets.BRIDGE_PATH) {
        call.response.header(HttpHeaders.CacheControl, "public, max-age=60, must-revalidate")
        call.response.header("X-Content-Type-Options", "nosniff")
        call.respondText(BridgeAssets.bridgeScript(), ContentType.parse(BridgeAssets.CONTENT_TYPE))
    }
}
