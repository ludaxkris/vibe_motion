package dev.vibemotion.api.routes

import dev.vibemotion.api.catalog.CatalogRepository
import io.ktor.http.ContentType
import io.ktor.server.application.ApplicationCall
import io.ktor.server.plugins.NotFoundException
import io.ktor.server.response.respond
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable

/** Response body of `GET /catalog/versions`. */
@Serializable
data class CatalogVersionsResponse(
    val current: String,
    val versions: List<String>,
)

/**
 * `GET /catalog`, `GET /catalog/versions`, `GET /catalog/{version}`.
 *
 * Catalog files are served verbatim so the web app, the exporter and the API provably agree on
 * the bytes.
 */
fun Route.catalogRoutes(catalog: CatalogRepository) {
    route("/catalog") {
        get {
            call.respondCatalog(catalog, catalog.currentVersion)
        }
        get("/versions") {
            call.respond(CatalogVersionsResponse(catalog.currentVersion, catalog.versions()))
        }
        get("/{version}") {
            call.respondCatalog(catalog, call.parameters["version"].orEmpty())
        }
    }
}

private suspend fun ApplicationCall.respondCatalog(
    catalog: CatalogRepository,
    version: String,
) {
    val body =
        catalog.rawJson(version)
            ?: throw NotFoundException("Unknown catalog version '$version'")
    respondText(body, ContentType.Application.Json)
}
