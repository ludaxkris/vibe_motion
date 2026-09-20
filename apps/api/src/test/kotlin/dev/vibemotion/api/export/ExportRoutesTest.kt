package dev.vibemotion.api.export

import dev.vibemotion.api.apiModule
import dev.vibemotion.api.domain.Diff
import dev.vibemotion.api.domain.Trigger
import dev.vibemotion.api.model.ApiError
import dev.vibemotion.api.persistence.DatabaseHealth
import dev.vibemotion.api.testConfig
import dev.vibemotion.api.testServices
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import io.ktor.client.request.get
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import java.util.UUID

private val json = Json { ignoreUnknownKeys = true }

/**
 * Every row of the export error table, plus the response's own headers, driven through the real
 * Ktor module with in-memory repositories. No database: the exporter is a pure function of what
 * one transaction hands it.
 */
class ExportRoutesTest :
    FunSpec({

        /** A project whose v0 is already in place, so a spec only writes the version it cares about. */
        fun fixture(): FakeExportRepositories = FakeExportRepositories().also { it.addVersion(0, Diff.EMPTY) }

        suspend fun withExportApi(
            repositories: FakeExportRepositories,
            html: PageEmitter = HtmlEmitter(),
            block: suspend ApplicationTestBuilder.() -> Unit,
        ) {
            val services =
                testServices(CATALOG).copy(
                    exports = ExportService(repositories, repositories, CATALOG, repositories, html),
                )
            testApplication {
                application { apiModule(testConfig(), CATALOG, DatabaseHealth { true }, services) }
                block()
            }
        }

        suspend fun HttpResponse.error(): ApiError = json.decodeFromString(ApiError.serializer(), bodyAsText())

        suspend fun HttpResponse.bundle(): ExportBundleDto = json.decodeFromString(ExportBundleDto.serializer(), bodyAsText())

        test("a project with one load assignment exports index.html, the stylesheet and no script") {
            val repositories = fixture()
            repositories.addVersion(1, Diff(set = mapOf("vm-1" to assignment())))

            withExportApi(repositories) {
                val response = client.get("/projects/${repositories.projectId}/export")

                response.status shouldBe HttpStatusCode.OK
                val bundle = response.bundle()
                bundle.mode shouldBe ExportMode.FULL
                bundle.versionId shouldBe repositories.currentVersionId.toString()
                bundle.files.map { it.name } shouldBe listOf("index.html", "vibe-motion.css")
                bundle.js shouldBe null
                bundle.html.orEmpty() shouldContain """class="vm-a1""""
                bundle.html.orEmpty() shouldContain """<link rel="stylesheet" href="vibe-motion.css">"""
                bundle.html.orEmpty() shouldNotContain "data-vm-id"
                bundle.css shouldContain ".vm-a1 {"
            }
        }

        test("an in-view assignment adds vibe-motion.js, the marker class and the script tag") {
            val repositories = fixture()
            repositories.addVersion(1, Diff(set = mapOf("vm-2" to assignment(trigger = Trigger.IN_VIEW))))

            withExportApi(repositories) {
                val bundle = client.get("/projects/${repositories.projectId}/export").bundle()

                bundle.files.map { it.name } shouldBe listOf("index.html", "vibe-motion.css", "vibe-motion.js")
                bundle.js.orEmpty() shouldContain "vm-in-view"
                bundle.html.orEmpty() shouldContain """class="lede vm-a2 vm-in-view""""
                bundle.html.orEmpty() shouldContain """<script src="vibe-motion.js"></script>"""
                bundle.css shouldContain ":where(.vm-js) .vm-a2 {"
            }
        }

        test("versionId picks that version; absent means the project's current one") {
            val repositories = fixture()
            val first = repositories.addVersion(1, Diff(set = mapOf("vm-1" to assignment())))
            repositories.addVersion(2, Diff(set = mapOf("vm-3" to assignment(animationId = "fade-in"))))

            withExportApi(repositories) {
                val current = client.get("/projects/${repositories.projectId}/export").bundle()
                current.css shouldContain ".vm-a3 {"

                val older = client.get("/projects/${repositories.projectId}/export?versionId=${first.id}").bundle()
                older.versionId shouldBe first.id.toString()
                older.css shouldNotContain ".vm-a3 {"
                older.css shouldContain ".vm-a1 {"
            }
        }

        test("snippet mode returns one element's CSS, no html, and never reads base_html") {
            val repositories = fixture()
            repositories.addVersion(1, Diff(set = mapOf("vm-1" to assignment(), "vm-2" to assignment(animationId = "fade-in"))))

            withExportApi(repositories) {
                val bundle = client.get("/projects/${repositories.projectId}/export?mode=snippet&vmId=vm-1").bundle()

                bundle.mode shouldBe ExportMode.SNIPPET
                bundle.html shouldBe null
                bundle.files.map { it.name } shouldBe listOf("vibe-motion.css")
                bundle.css shouldContain """/* add class="vm-a1" to the element */"""
                bundle.css shouldNotContain "vm-a2"
                repositories.baseHtmlReads shouldBe 0
            }
        }

        test("an in-view snippet also carries the script") {
            val repositories = fixture()
            repositories.addVersion(1, Diff(set = mapOf("vm-1" to assignment(trigger = Trigger.IN_VIEW))))

            withExportApi(repositories) {
                val bundle = client.get("/projects/${repositories.projectId}/export?mode=snippet&vmId=vm-1").bundle()

                bundle.files.map { it.name } shouldBe listOf("vibe-motion.css", "vibe-motion.js")
                bundle.js.orEmpty() shouldContain "IntersectionObserver"
                bundle.css shouldContain """/* add class="vm-a1 vm-in-view" to the element */"""
            }
        }

        test("an unknown project is 404 not_found") {
            val repositories = fixture()

            withExportApi(repositories) {
                val response = client.get("/projects/${UUID.randomUUID()}/export")

                response.status shouldBe HttpStatusCode.NotFound
                response.error().code shouldBe "not_found"
            }
        }

        test("a version that belongs to another project is 404 not_found, not a leak") {
            val repositories = fixture()
            val foreign = repositories.addVersion(0, Diff.EMPTY, projectId = UUID.randomUUID())

            withExportApi(repositories) {
                val response = client.get("/projects/${repositories.projectId}/export?versionId=${foreign.id}")

                response.status shouldBe HttpStatusCode.NotFound
                response.error().code shouldBe "not_found"
            }
        }

        test("a malformed projectId or versionId is 400 bad_request") {
            val repositories = fixture()

            withExportApi(repositories) {
                listOf(
                    "/projects/not-a-uuid/export",
                    "/projects/${repositories.projectId}/export?versionId=nope",
                ).forEach { path ->
                    val response = client.get(path)

                    withClue(path) {
                        response.status shouldBe HttpStatusCode.BadRequest
                        response.error().code shouldBe "bad_request"
                    }
                }
            }
        }

        test("a mode that is not full or snippet is 400 bad_request, never a silent full export") {
            val repositories = fixture()

            withExportApi(repositories) {
                val response = client.get("/projects/${repositories.projectId}/export?mode=Full")

                response.status shouldBe HttpStatusCode.BadRequest
                response.error().code shouldBe "bad_request"
            }
        }

        test("snippet mode without a vmId is 400 missing_vm_id") {
            val repositories = fixture()

            withExportApi(repositories) {
                val response = client.get("/projects/${repositories.projectId}/export?mode=snippet")

                response.status shouldBe HttpStatusCode.BadRequest
                response.error().code shouldBe "missing_vm_id"
            }
        }

        test("a vmId a clone could never have produced is 400 bad_request, and is never echoed") {
            val repositories = fixture()

            withExportApi(repositories) {
                val response = client.get("/projects/${repositories.projectId}/export?mode=snippet&vmId=vm-1%7D")

                response.status shouldBe HttpStatusCode.BadRequest
                response.error().code shouldBe "bad_request"
                response.bodyAsText() shouldNotContain "vm-1}"
            }
        }

        test("a snippet of an element with no assignment is 404, not an empty stylesheet") {
            val repositories = fixture()
            repositories.addVersion(1, Diff(set = mapOf("vm-1" to assignment())))

            withExportApi(repositories) {
                val response = client.get("/projects/${repositories.projectId}/export?mode=snippet&vmId=vm-9")

                response.status shouldBe HttpStatusCode.NotFound
                response.error().code shouldBe "not_found"
            }
        }

        test("an assignment that cannot be resolved is a 500, and the body says nothing about it") {
            val repositories = fixture()
            repositories.addVersion(1, Diff(set = mapOf("vm-1" to assignment(catalogVersion = "9.9.9"))))

            withExportApi(repositories) {
                val response = client.get("/projects/${repositories.projectId}/export")

                response.status shouldBe HttpStatusCode.InternalServerError
                response.error().code shouldBe "internal_error"
                // The log names the element; the response does not.
                response.bodyAsText() shouldNotContain "vm-1"
                response.bodyAsText() shouldNotContain "9.9.9"
            }
        }

        test("a stored param value that no longer validates is a 500, and the value never leaves the process") {
            val repositories = fixture()
            repositories.addVersion(
                1,
                Diff(set = mapOf("vm-1" to assignment(params = mapOf("distance" to "1px; } body { display: none")))),
            )

            withExportApi(repositories) {
                val response = client.get("/projects/${repositories.projectId}/export")

                response.status shouldBe HttpStatusCode.InternalServerError
                response.bodyAsText() shouldNotContain "display"
            }
        }

        test("the response is no-store and nosniff") {
            val repositories = fixture()
            repositories.addVersion(1, Diff(set = mapOf("vm-1" to assignment())))

            withExportApi(repositories) {
                val response = client.get("/projects/${repositories.projectId}/export")

                response.headers[HttpHeaders.CacheControl] shouldBe "no-store"
                // Global, but it matters most here: the body is attacker-influenced HTML inside
                // JSON on an origin that serves cloned pages under `script-src 'self'`.
                response.headers["X-Content-Type-Options"] shouldBe "nosniff"
            }
        }

        test("a version with no assignments still exports a page and a header-only stylesheet") {
            val repositories = fixture()

            withExportApi(repositories) {
                val bundle = client.get("/projects/${repositories.projectId}/export").bundle()

                bundle.js shouldBe null
                bundle.css shouldContain "/* Vibe Motion · format 1 · v0 · saved 2026-09-20 (UTC) */"
                bundle.html.orEmpty() shouldContain """<link rel="stylesheet" href="vibe-motion.css">"""
                bundle.html.orEmpty() shouldNotContain "data-vm-id"
            }
        }

        test("an assignment for an element base_html does not have is dead CSS, not an error") {
            // A stale `vmId` in the state — a re-clone, a hand-made fixture, a future edit — must
            // not fail the export. The class lands nowhere and the rules are inert.
            val repositories = fixture()
            repositories.addVersion(
                1,
                Diff(set = mapOf("vm-1" to assignment(), "vm-99" to assignment(trigger = Trigger.IN_VIEW))),
            )

            withExportApi(repositories) {
                val response = client.get("/projects/${repositories.projectId}/export")

                response.status shouldBe HttpStatusCode.OK
                val bundle = response.bundle()
                bundle.html.orEmpty() shouldContain """class="vm-a1""""
                bundle.html.orEmpty() shouldNotContain "vm-a99"
                // The stylesheet still carries the rules, and the script still ships: the state
                // says there is an in-view assignment, and the exporter does not second-guess it.
                bundle.css shouldContain ":where(.vm-js) .vm-a99 {"
                bundle.files.map { it.name } shouldBe listOf("index.html", "vibe-motion.css", "vibe-motion.js")
            }
        }

        test("a failure inside the emitters is a 500, not the 400 an IllegalArgumentException maps to") {
            val repositories = fixture()
            repositories.addVersion(1, Diff(set = mapOf("vm-1" to assignment())))
            val exploding =
                PageEmitter { _, _, _ -> throw IllegalArgumentException("jsoup: Object must not be null") }

            withExportApi(repositories, html = exploding) {
                val response = client.get("/projects/${repositories.projectId}/export")

                response.status shouldBe HttpStatusCode.InternalServerError
                response.error().code shouldBe "internal_error"
                response.bodyAsText() shouldNotContain "jsoup"
            }
        }

        test("a removed assignment is gone from the export, because the state is the folded diff") {
            val repositories = fixture()
            repositories.addVersion(1, Diff(set = mapOf("vm-1" to assignment(), "vm-2" to assignment())))
            repositories.addVersion(2, Diff(remove = listOf("vm-1")))

            withExportApi(repositories) {
                val bundle = client.get("/projects/${repositories.projectId}/export").bundle()

                bundle.css shouldNotContain ".vm-a1 {"
                bundle.css shouldContain ".vm-a2 {"
                bundle.html.orEmpty() shouldNotContain "vm-a1"
            }
        }
    })
