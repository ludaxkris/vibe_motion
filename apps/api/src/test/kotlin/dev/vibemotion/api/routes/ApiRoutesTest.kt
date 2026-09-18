package dev.vibemotion.api.routes

import dev.vibemotion.api.TEST_WEB_ORIGIN
import dev.vibemotion.api.apiModule
import dev.vibemotion.api.catalog.ClasspathCatalogRepository
import dev.vibemotion.api.config.DatabaseSettings
import dev.vibemotion.api.model.ApiError
import dev.vibemotion.api.persistence.AppDatabase
import dev.vibemotion.api.persistence.DatabaseHealth
import dev.vibemotion.api.testConfig
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json

/**
 * Route behaviour that does not need a database: catalog endpoints, the error envelope, CORS,
 * and the 503 path of /health. The Postgres-backed half lives in ApiIntegrationTest.
 */
class ApiRoutesTest :
    FunSpec({

        val catalog = ClasspathCatalogRepository.load()
        val json = Json { ignoreUnknownKeys = true }

        fun healthOf(reachable: Boolean) = DatabaseHealth { reachable }

        test("GET /catalog serves the current version verbatim") {
            testApplication {
                application { apiModule(testConfig(), catalog, healthOf(true)) }

                val response = client.get("/catalog")

                response.status shouldBe HttpStatusCode.OK
                response.contentType()?.withoutParameters() shouldBe ContentType.Application.Json
                response.bodyAsText() shouldBe catalog.rawJson(catalog.currentVersion)
            }
        }

        test("GET /catalog/versions lists the published versions and the current pointer") {
            testApplication {
                application { apiModule(testConfig(), catalog, healthOf(true)) }

                val body = json.decodeFromString<CatalogVersionsResponse>(client.get("/catalog/versions").bodyAsText())

                body.current shouldBe catalog.currentVersion
                body.versions shouldBe catalog.versions()
            }
        }

        test("GET /catalog/{version} serves a published version") {
            testApplication {
                application { apiModule(testConfig(), catalog, healthOf(true)) }

                val response = client.get("/catalog/${catalog.currentVersion}")

                response.status shouldBe HttpStatusCode.OK
                response.bodyAsText() shouldBe catalog.rawJson(catalog.currentVersion)
            }
        }

        test("GET /catalog/{version} answers 404 with an Error body for an unknown version") {
            testApplication {
                application { apiModule(testConfig(), catalog, healthOf(true)) }

                val response = client.get("/catalog/9.9.9")

                response.status shouldBe HttpStatusCode.NotFound
                val error = json.decodeFromString<ApiError>(response.bodyAsText())
                error.code shouldBe "not_found"
                error.message shouldContain "9.9.9"
            }
        }

        test("an unknown route answers 404 with an Error body") {
            testApplication {
                application { apiModule(testConfig(), catalog, healthOf(true)) }

                val response = client.get("/nope")

                response.status shouldBe HttpStatusCode.NotFound
                json.decodeFromString<ApiError>(response.bodyAsText()).code shouldBe "not_found"
            }
        }

        test("GET /health reports 503 and db down when Postgres is unreachable") {
            // A pool pointed at a closed port, with the shortest timeout Hikari accepts.
            val pool =
                AppDatabase.pool(
                    DatabaseSettings("jdbc:postgresql://127.0.0.1:1/vibe_motion", "nobody", "nobody"),
                    maximumPoolSize = 1,
                    connectionTimeoutMs = 250,
                )
            try {
                testApplication {
                    application { apiModule(testConfig(), catalog, { AppDatabase.probe(pool) }) }

                    val response = client.get("/health")

                    response.status shouldBe HttpStatusCode.ServiceUnavailable
                    val health = json.decodeFromString<HealthResponse>(response.bodyAsText())
                    health.status shouldBe "degraded"
                    health.db shouldBe "down"
                }
            } finally {
                pool.close()
            }
        }

        test("CORS allows the configured web origin") {
            testApplication {
                application { apiModule(testConfig(), catalog, healthOf(true)) }

                val response =
                    client.get("/catalog/versions") {
                        header(HttpHeaders.Origin, TEST_WEB_ORIGIN)
                    }

                response.status shouldBe HttpStatusCode.OK
                response.headers[HttpHeaders.AccessControlAllowOrigin] shouldBe TEST_WEB_ORIGIN
            }
        }

        test("CORS rejects any other origin") {
            testApplication {
                application { apiModule(testConfig(), catalog, healthOf(true)) }

                val response =
                    client.get("/catalog/versions") {
                        header(HttpHeaders.Origin, "https://evil.example.com")
                    }

                response.status shouldBe HttpStatusCode.Forbidden
            }
        }
    })
