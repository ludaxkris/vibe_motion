package dev.vibemotion.api

import dev.vibemotion.api.catalog.CatalogRepository
import dev.vibemotion.api.catalog.ClasspathCatalogRepository
import dev.vibemotion.api.clone.CloneException
import dev.vibemotion.api.config.AppConfig
import dev.vibemotion.api.domain.EmptyDiffException
import dev.vibemotion.api.domain.InvalidDiffException
import dev.vibemotion.api.domain.ResourceNotFoundException
import dev.vibemotion.api.domain.StaleParentErrorBody
import dev.vibemotion.api.domain.StaleParentException
import dev.vibemotion.api.model.ApiError
import dev.vibemotion.api.persistence.AppDatabase
import dev.vibemotion.api.persistence.DatabaseHealth
import dev.vibemotion.api.routes.bridgeRoutes
import dev.vibemotion.api.routes.catalogRoutes
import dev.vibemotion.api.routes.healthRoutes
import dev.vibemotion.api.routes.projectRoutes
import dev.vibemotion.api.routes.versionRoutes
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.ktor.http.hostWithPort
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.plugins.NotFoundException
import io.ktor.server.plugins.calllogging.CallLogging
import io.ktor.server.plugins.calllogging.processingTimeMillis
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.plugins.defaultheaders.DefaultHeaders
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.request.httpMethod
import io.ktor.server.request.path
import io.ktor.server.response.respond
import io.ktor.server.routing.routing
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import org.slf4j.LoggerFactory
import org.slf4j.event.Level

private val log = LoggerFactory.getLogger("dev.vibemotion.api.Application")

fun main() {
    val config = AppConfig.fromEnv()
    val database = AppDatabase.start(config.database)
    val catalog = ClasspathCatalogRepository.load()
    val (cloner, renderer) = defaultCloneComponents(config)
    val services = appServices(catalog, cloner, renderer)

    Runtime.getRuntime().addShutdownHook(Thread { database.close() })

    log.info("Starting vibe-motion-api on port {} (web origin {})", config.port, config.webOrigin)
    embeddedServer(Netty, port = config.port, host = "0.0.0.0") {
        apiModule(config, catalog, database, services)
    }.start(wait = true)
}

/**
 * The Ktor module. Dependencies are passed in rather than built here so tests can drive the same
 * wiring against a Testcontainers database or a deliberately broken one.
 */
fun Application.apiModule(
    config: AppConfig,
    catalog: CatalogRepository,
    databaseHealth: DatabaseHealth,
    services: AppServices,
) {
    install(DefaultHeaders)

    install(CallLogging) {
        level = Level.INFO
        format { call ->
            "${call.response.status()?.value ?: "-"} ${call.request.httpMethod.value} ${call.request.path()}" +
                " (${call.processingTimeMillis()}ms)"
        }
    }

    install(ContentNegotiation) {
        json(Json { encodeDefaults = true })
    }

    install(CORS) {
        // AppConfig has already refused anything Url() cannot read as an absolute http(s) origin,
        // so this cannot quietly allow-list nothing.
        val origin = Url(config.webOrigin)
        allowHost(origin.hostWithPort, schemes = listOf(origin.protocol.name))
        allowMethod(HttpMethod.Get)
        allowMethod(HttpMethod.Post)
        allowMethod(HttpMethod.Delete)
        allowHeader(HttpHeaders.ContentType)
    }

    install(StatusPages) {
        // Clone failures carry their own contract code; only the status differs per subtype.
        exception<CloneException> { call, cause ->
            val status =
                when (cause) {
                    is CloneException.InvalidUrl -> HttpStatusCode.BadRequest

                    is CloneException.TooLarge -> HttpStatusCode.PayloadTooLarge

                    is CloneException.Blocked,
                    is CloneException.Unreachable,
                    is CloneException.NotHtml,
                    -> HttpStatusCode.UnprocessableEntity
                }
            call.respond(status, ApiError(cause.code, cause.message ?: "Could not clone that page"))
        }
        exception<ResourceNotFoundException> { call, cause ->
            call.respond(HttpStatusCode.NotFound, ApiError("not_found", cause.message ?: "Not found"))
        }
        exception<StaleParentException> { call, cause ->
            call.respond(
                HttpStatusCode.Conflict,
                StaleParentErrorBody(
                    code = "stale_parent",
                    message = cause.message ?: "The project has a newer version",
                    currentVersion = cause.currentVersion,
                ),
            )
        }
        exception<EmptyDiffException> { call, cause ->
            call.respond(HttpStatusCode.BadRequest, ApiError("empty_diff", cause.message ?: "Diff is empty"))
        }
        exception<InvalidDiffException> { call, cause ->
            call.respond(HttpStatusCode.UnprocessableEntity, ApiError("invalid_diff", cause.problems.joinToString("; ")))
        }
        exception<NotFoundException> { call, cause ->
            call.respond(HttpStatusCode.NotFound, ApiError("not_found", cause.message ?: "Not found"))
        }
        exception<BadRequestException> { call, cause ->
            call.respond(HttpStatusCode.BadRequest, ApiError("bad_request", cause.message ?: "Malformed request"))
        }
        exception<SerializationException> { call, cause ->
            call.respond(HttpStatusCode.BadRequest, ApiError("bad_request", cause.message ?: "Malformed JSON"))
        }
        exception<IllegalArgumentException> { call, cause ->
            call.respond(HttpStatusCode.BadRequest, ApiError("bad_request", cause.message ?: "Malformed request"))
        }
        exception<Throwable> { call, cause ->
            log.error("Unhandled failure on {}", call.request.path(), cause)
            call.respond(HttpStatusCode.InternalServerError, ApiError("internal_error", "Unexpected server error"))
        }
        // Routes that matched nothing. Handlers above mark the call as handled, so this only
        // fires for a genuinely unknown path.
        status(HttpStatusCode.NotFound) { call, _ ->
            call.respond(
                HttpStatusCode.NotFound,
                ApiError("not_found", "No route for ${call.request.httpMethod.value} ${call.request.path()}"),
            )
        }
    }

    routing {
        healthRoutes(databaseHealth, config.appVersion)
        catalogRoutes(catalog)
        projectRoutes(services.projects)
        versionRoutes(services.versions)
        bridgeRoutes()
    }
}
