package dev.vibemotion.api.routes

import dev.vibemotion.api.domain.CreateVersionRequest
import dev.vibemotion.api.domain.RestoreVersionRequest
import dev.vibemotion.api.versions.VersionService
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.serialization.json.Json

private val restoreJson = Json { ignoreUnknownKeys = true }

/**
 * `GET|POST /projects/{projectId}/versions`, `GET .../{versionId}/state`,
 * `POST .../{versionId}/restore`.
 */
fun Route.versionRoutes(versions: VersionService) {
    route("/projects/{projectId}/versions") {
        get {
            call.respond(versions.list(call.uuidParameter("projectId")))
        }

        post {
            val request = call.receiveLimited(CreateVersionRequest.serializer())
            call.respond(HttpStatusCode.Created, versions.create(call.uuidParameter("projectId"), request))
        }

        get("/{versionId}/state") {
            call.respond(versions.stateAt(call.uuidParameter("projectId"), call.uuidParameter("versionId")))
        }

        post("/{versionId}/restore") {
            val restored =
                versions.restore(
                    projectId = call.uuidParameter("projectId"),
                    versionId = call.uuidParameter("versionId"),
                    label = call.restoreLabel(),
                )
            call.respond(HttpStatusCode.Created, restored)
        }
    }
}

/**
 * The restore body is optional in the contract, so it is read as text rather than negotiated: a
 * `POST` with no body at all, and one with `{}`, both mean "use the generated label". The same
 * 256 KB cap applies — an optional body is not an unbounded one.
 */
private suspend fun ApplicationCall.restoreLabel(): String? {
    val body = receiveLimitedText()
    if (body.isBlank()) return null
    return restoreJson.decodeFromString(RestoreVersionRequest.serializer(), body).label
}
