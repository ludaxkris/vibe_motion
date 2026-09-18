package dev.vibemotion.api.routes

import dev.vibemotion.api.FakePageCloner
import dev.vibemotion.api.TEST_WEB_ORIGIN
import dev.vibemotion.api.apiModule
import dev.vibemotion.api.catalog.ClasspathCatalogRepository
import dev.vibemotion.api.clone.CloneException
import dev.vibemotion.api.config.DatabaseSettings
import dev.vibemotion.api.model.ApiError
import dev.vibemotion.api.persistence.AppDatabase
import dev.vibemotion.api.persistence.DatabaseHealth
import dev.vibemotion.api.testConfig
import dev.vibemotion.api.testServices
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.string.shouldContain
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import io.ktor.utils.io.ByteWriteChannel
import io.ktor.utils.io.writeStringUtf8
import kotlinx.serialization.json.Json

/** Enough 8 KB chunks to run past the 256 KB cap without being anywhere near a real body. */
private const val CHUNK_SIZE = 8 * 1024
private const val CHUNKS_OVER_THE_CAP = 40

/**
 * Route behaviour that does not need a database: catalog endpoints, the error envelope, CORS,
 * and the 503 path of /health. The Postgres-backed half lives in ApiIntegrationTest.
 */
class ApiRoutesTest :
    FunSpec({

        val catalog = ClasspathCatalogRepository.load()
        val services = testServices(catalog)
        val json = Json { ignoreUnknownKeys = true }

        fun healthOf(reachable: Boolean) = DatabaseHealth { reachable }

        test("GET /bridge/vm-bridge.js serves the bridge script as JavaScript") {
            testApplication {
                application { apiModule(testConfig(), catalog, healthOf(true), services) }
                val response = client.get("/bridge/vm-bridge.js")
                response.status shouldBe HttpStatusCode.OK
                response.contentType()?.withoutParameters() shouldBe ContentType.parse("application/javascript")
                response.headers["X-Content-Type-Options"] shouldBe "nosniff"
                response.bodyAsText() shouldContain "vibe-motion"
            }
        }

        test("the bridge script is revalidatable: no-cache, an ETag, and a 304 on a match") {
            testApplication {
                application { apiModule(testConfig(), catalog, healthOf(true), services) }

                val first = client.get("/bridge/vm-bridge.js")
                first.headers[HttpHeaders.CacheControl] shouldBe "no-cache"
                val etag = first.headers[HttpHeaders.ETag]
                (etag?.startsWith("\"") ?: false) shouldBe true

                val second = client.get("/bridge/vm-bridge.js") { header(HttpHeaders.IfNoneMatch, etag) }
                second.status shouldBe HttpStatusCode.NotModified
                second.bodyAsText() shouldBe ""
                second.headers[HttpHeaders.ETag] shouldBe etag

                // A validator from some other build must still get the whole script.
                val stale = client.get("/bridge/vm-bridge.js") { header(HttpHeaders.IfNoneMatch, "\"stale\"") }
                stale.status shouldBe HttpStatusCode.OK
            }
        }

        test("nosniff is installed globally, not per route") {
            // `script-src 'self'` on this origin means any response a browser could be talked into
            // sniffing as JavaScript is a script gadget inside a cloned page.
            testApplication {
                application { apiModule(testConfig(), catalog, healthOf(true), services) }

                listOf("/catalog", "/catalog/versions", "/health", "/nope").forEach { path ->
                    withClue(path) { client.get(path).headers["X-Content-Type-Options"] shouldBe "nosniff" }
                }
            }
        }

        test("POST /projects answers 503 clone_busy with Retry-After when the instance is at its clone limit") {
            val cloner = FakePageCloner(failure = { CloneException.Busy("Too many clones in flight", retryAfterSeconds = 5) })
            testApplication {
                application { apiModule(testConfig(), catalog, healthOf(true), testServices(catalog, cloner)) }

                val response =
                    client.post("/projects") {
                        contentType(ContentType.Application.Json)
                        setBody("""{"url":"https://example.com"}""")
                    }

                response.status shouldBe HttpStatusCode.ServiceUnavailable
                response.headers[HttpHeaders.RetryAfter] shouldBe "5"
                json.decodeFromString<ApiError>(response.bodyAsText()).code shouldBe "clone_busy"
            }
        }

        test("a JSON body over the cap is refused on Content-Length, before the handler runs") {
            val cloner = FakePageCloner()
            testApplication {
                application { apiModule(testConfig(), catalog, healthOf(true), testServices(catalog, cloner)) }

                val response =
                    client.post("/projects") {
                        contentType(ContentType.Application.Json)
                        setBody("""{"url":"https://example.com/${"x".repeat(MAX_JSON_BODY_BYTES.toInt())}"}""")
                    }

                response.status shouldBe HttpStatusCode.PayloadTooLarge
                json.decodeFromString<ApiError>(response.bodyAsText()).code shouldBe "payload_too_large"
                // Nothing was cloned: the body never reached the route handler.
                cloner.requestedUrls.shouldBeEmpty()
            }
        }

        test("a chunked body with no Content-Length is cut off at the same cap") {
            val cloner = FakePageCloner()
            testApplication {
                application { apiModule(testConfig(), catalog, healthOf(true), testServices(catalog, cloner)) }

                val response =
                    client.post("/projects") {
                        contentType(ContentType.Application.Json)
                        setBody(
                            object : OutgoingContent.WriteChannelContent() {
                                // No contentLength, so the request is sent chunked and the
                                // up-front Content-Length check cannot fire.
                                override suspend fun writeTo(channel: ByteWriteChannel) {
                                    channel.writeStringUtf8("""{"url":"https://example.com/""")
                                    repeat(CHUNKS_OVER_THE_CAP) { channel.writeStringUtf8("x".repeat(CHUNK_SIZE)) }
                                    channel.writeStringUtf8(""""}""")
                                    channel.flush()
                                }
                            },
                        )
                    }

                response.status shouldBe HttpStatusCode.PayloadTooLarge
                json.decodeFromString<ApiError>(response.bodyAsText()).code shouldBe "payload_too_large"
                cloner.requestedUrls.shouldBeEmpty()
            }
        }

        test("a body just under the cap is read and parsed") {
            val cloner = FakePageCloner()
            testApplication {
                application { apiModule(testConfig(), catalog, healthOf(true), testServices(catalog, cloner)) }

                val padding = "x".repeat(MAX_JSON_BODY_BYTES.toInt() - 64)
                val response =
                    client.post("/projects") {
                        contentType(ContentType.Application.Json)
                        setBody("""{"url":"https://example.com/$padding"}""")
                    }

                // This spec has no database, so what happens after the clone is another test's
                // business; that the body was read in full and handed to the pipeline is this one's.
                response.status shouldNotBe HttpStatusCode.PayloadTooLarge
                cloner.requestedUrls shouldHaveSize 1
            }
        }

        test("GET /catalog serves the current version verbatim") {
            testApplication {
                application { apiModule(testConfig(), catalog, healthOf(true), services) }

                val response = client.get("/catalog")

                response.status shouldBe HttpStatusCode.OK
                response.contentType()?.withoutParameters() shouldBe ContentType.Application.Json
                response.bodyAsText() shouldBe catalog.rawJson(catalog.currentVersion)
            }
        }

        test("GET /catalog/versions lists the published versions and the current pointer") {
            testApplication {
                application { apiModule(testConfig(), catalog, healthOf(true), services) }

                val body = json.decodeFromString<CatalogVersionsResponse>(client.get("/catalog/versions").bodyAsText())

                body.current shouldBe catalog.currentVersion
                body.versions shouldBe catalog.versions()
            }
        }

        test("GET /catalog/{version} serves a published version") {
            testApplication {
                application { apiModule(testConfig(), catalog, healthOf(true), services) }

                val response = client.get("/catalog/${catalog.currentVersion}")

                response.status shouldBe HttpStatusCode.OK
                response.bodyAsText() shouldBe catalog.rawJson(catalog.currentVersion)
            }
        }

        test("GET /catalog/{version} answers 404 with an Error body for an unknown version") {
            testApplication {
                application { apiModule(testConfig(), catalog, healthOf(true), services) }

                val response = client.get("/catalog/9.9.9")

                response.status shouldBe HttpStatusCode.NotFound
                val error = json.decodeFromString<ApiError>(response.bodyAsText())
                error.code shouldBe "not_found"
                error.message shouldContain "9.9.9"
            }
        }

        test("an unknown route answers 404 with an Error body") {
            testApplication {
                application { apiModule(testConfig(), catalog, healthOf(true), services) }

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
                    application { apiModule(testConfig(), catalog, { AppDatabase.probe(pool) }, services) }

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
                application { apiModule(testConfig(), catalog, healthOf(true), services) }

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
                application { apiModule(testConfig(), catalog, healthOf(true), services) }

                val response =
                    client.get("/catalog/versions") {
                        header(HttpHeaders.Origin, "https://evil.example.com")
                    }

                response.status shouldBe HttpStatusCode.Forbidden
            }
        }
    })
