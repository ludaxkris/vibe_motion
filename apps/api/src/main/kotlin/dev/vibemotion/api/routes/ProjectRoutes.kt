package dev.vibemotion.api.routes

import dev.vibemotion.api.domain.CreateProjectRequest
import dev.vibemotion.api.domain.ResourceNotFoundException
import dev.vibemotion.api.model.ifNoneMatch
import dev.vibemotion.api.projects.ProjectService
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.request.header
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
            val request = call.receiveLimited(CreateProjectRequest.serializer())
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
                val projectId = call.uuidParameter("projectId")
                val etag = projects.pageETag(projectId)
                call.response.header(HttpHeaders.ETag, etag)
                // Never cached by freshness: a deleted project must 404 and a CSP or bridge fix
                // must not have to wait out a max-age. Revalidation is what the ETag is for.
                call.response.header(HttpHeaders.CacheControl, "private, no-cache")
                // The project URL is a capability in v0 (there is no auth), so no request the
                // cloned page makes may carry it, not even the origin.
                call.response.header(REFERRER_POLICY_HEADER, "no-referrer")

                if (ifNoneMatch(call.request.header(HttpHeaders.IfNoneMatch), etag)) {
                    // Existence only: reading base_html here would give up the whole point of a
                    // 304, but a validator hit on a deleted project must still be a 404.
                    if (!projects.exists(projectId)) throw ResourceNotFoundException("No project $projectId")
                    call.respond(HttpStatusCode.NotModified)
                    return@get
                }

                val page = projects.page(projectId)
                // The policy also travels in a meta tag inside the document, but the header is what
                // a browser enforces first, and it cannot be neutralised by the cloned markup.
                call.response.header(CONTENT_SECURITY_POLICY_HEADER, page.contentSecurityPolicy)
                call.respondText(page.html, ContentType.Text.Html)
            }
        }
    }
}

internal const val CONTENT_SECURITY_POLICY_HEADER = "Content-Security-Policy"

/** Installed globally by `DefaultHeaders`; the constant lives here with the other header names. */
internal const val NO_SNIFF_HEADER = "X-Content-Type-Options"

internal const val REFERRER_POLICY_HEADER = "Referrer-Policy"

/** A path id that is not a uuid is a malformed request, not a missing resource. */
internal fun ApplicationCall.uuidParameter(name: String): UUID {
    val raw = parameters[name].orEmpty()
    return runCatching { UUID.fromString(raw) }.getOrElse {
        throw BadRequestException("$name must be a uuid, got '$raw'")
    }
}

/**
 * An optional uuid from the **query string**.
 *
 * Read through `request.queryParameters` rather than `parameters`, which merges path and query: a
 * helper that looked in both would answer a missing optional parameter with a path value of the
 * same name, and there is no sensible 400 for "absent" when absent is legal.
 */
internal fun ApplicationCall.optionalUuidQuery(name: String): UUID? {
    val raw = request.queryParameters[name] ?: return null
    return runCatching { UUID.fromString(raw) }.getOrElse {
        throw BadRequestException("$name must be a uuid, got '$raw'")
    }
}
