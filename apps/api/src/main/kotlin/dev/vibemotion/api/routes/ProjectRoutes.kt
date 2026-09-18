package dev.vibemotion.api.routes

import dev.vibemotion.api.domain.CreateProjectRequest
import dev.vibemotion.api.projects.ProjectService
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.request.receive
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import java.util.UUID

/**
 * `POST /projects`, `GET|DELETE /projects/{projectId}`, `GET /projects/{projectId}/page`.
 *
 * Thin by design: parse, delegate, choose a status. Every failure is a domain exception mapped in
 * the StatusPages block.
 */
fun Route.projectRoutes(projects: ProjectService) {
    route("/projects") {
        post {
            val request = call.receive<CreateProjectRequest>()
            call.respond(HttpStatusCode.Created, projects.create(request.url))
        }

        route("/{projectId}") {
            get {
                call.respond(projects.get(call.uuidParameter("projectId")))
            }

            delete {
                projects.delete(call.uuidParameter("projectId"))
                call.respond(HttpStatusCode.NoContent)
            }

            get("/page") {
                val page = projects.page(call.uuidParameter("projectId"))
                // The policy also travels in a meta tag inside the document, but the header is what
                // a browser enforces first, and it cannot be neutralised by the cloned markup.
                call.response.header(CONTENT_SECURITY_POLICY_HEADER, page.contentSecurityPolicy)
                call.response.header(NO_SNIFF_HEADER, "nosniff")
                call.respondText(page.html, ContentType.Text.Html)
            }
        }
    }
}

internal const val CONTENT_SECURITY_POLICY_HEADER = "Content-Security-Policy"
internal const val NO_SNIFF_HEADER = "X-Content-Type-Options"

/** A path id that is not a uuid is a malformed request, not a missing resource. */
internal fun ApplicationCall.uuidParameter(name: String): UUID {
    val raw = parameters[name].orEmpty()
    return runCatching { UUID.fromString(raw) }.getOrElse {
        throw BadRequestException("$name must be a uuid, got '$raw'")
    }
}
