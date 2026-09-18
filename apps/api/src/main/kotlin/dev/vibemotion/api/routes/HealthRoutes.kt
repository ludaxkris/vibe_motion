package dev.vibemotion.api.routes

import dev.vibemotion.api.persistence.DatabaseHealth
import io.ktor.http.HttpStatusCode
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import kotlinx.serialization.Serializable

/** The `Health` schema from openapi.yaml. */
@Serializable
data class HealthResponse(
    val status: String,
    val db: String,
    val version: String,
)

/** `GET /health` — liveness plus a `select 1` against Postgres. 503 when the database is down. */
fun Route.healthRoutes(
    databaseHealth: DatabaseHealth,
    appVersion: String,
) {
    get("/health") {
        val up = databaseHealth.isReachable()
        call.respond(
            if (up) HttpStatusCode.OK else HttpStatusCode.ServiceUnavailable,
            HealthResponse(
                status = if (up) "ok" else "degraded",
                db = if (up) "ok" else "down",
                version = appVersion,
            ),
        )
    }
}
