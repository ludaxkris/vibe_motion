package dev.vibemotion.api.routes

import dev.vibemotion.api.export.ExportMode
import dev.vibemotion.api.export.ExportRequest
import dev.vibemotion.api.export.ExportService
import io.ktor.http.HttpHeaders
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get

/**
 * `GET /projects/{projectId}/export`.
 *
 * Thin, like the others: parse the query, delegate, set one header. Every refusal is a domain
 * exception mapped in the StatusPages block, and [ExportRequest] validates its own shape.
 */
fun Route.exportRoutes(exports: ExportService) {
    get("/projects/{projectId}/export") {
        val bundle =
            exports.export(
                ExportRequest(
                    projectId = call.uuidParameter("projectId"),
                    versionId = call.optionalUuidQuery("versionId"),
                    mode = ExportMode.parse(call.request.queryParameters["mode"]),
                    vmId = call.request.queryParameters["vmId"],
                ),
            )

        // A saved version is immutable, but the bytes are not a pure function of it alone: they
        // also depend on this build's sanitiser, which is the whole point of DT-073. An ETag and
        // a 304 are a contract addition and a deferred task; until then, revalidate every time.
        call.response.header(HttpHeaders.CacheControl, "no-store")
        call.respond(bundle)
    }
}
