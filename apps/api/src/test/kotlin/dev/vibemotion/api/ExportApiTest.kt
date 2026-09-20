package dev.vibemotion.api

import dev.vibemotion.api.catalog.ClasspathCatalogRepository
import dev.vibemotion.api.config.DatabaseSettings
import dev.vibemotion.api.domain.Assignment
import dev.vibemotion.api.domain.Diff
import dev.vibemotion.api.domain.ProjectDto
import dev.vibemotion.api.domain.Trigger
import dev.vibemotion.api.domain.VersionDto
import dev.vibemotion.api.export.ExportBundleDto
import dev.vibemotion.api.export.ExportMode
import dev.vibemotion.api.persistence.AppDatabase
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.utility.DockerImageName

/**
 * The export endpoint against a real Postgres, through the production wiring: clone a page, save a
 * version, export it. `ExportRoutesTest` covers every refusal with fakes; this proves the reads —
 * the diff fold, the project-scoped version lookup and the `base_html` column — actually work.
 */
class ExportApiTest :
    FunSpec({

        val postgres = PostgreSQLContainer<Nothing>(DockerImageName.parse("postgres:16-alpine"))
        val catalog = ClasspathCatalogRepository.load()
        val cloner = FakePageCloner()
        val services = testServices(catalog, cloner)
        val json = Json { ignoreUnknownKeys = true }
        lateinit var database: AppDatabase

        beforeSpec {
            postgres.start()
            database = AppDatabase.start(DatabaseSettings(postgres.jdbcUrl, postgres.username, postgres.password))
        }

        afterSpec {
            database.close()
            postgres.stop()
        }

        beforeTest { cloner.reset() }

        fun config() = testConfig(database = DatabaseSettings(postgres.jdbcUrl, postgres.username, postgres.password))

        suspend fun withApi(block: suspend ApplicationTestBuilder.() -> Unit) =
            testApplication {
                application { apiModule(config(), catalog, database, services) }
                block()
            }

        suspend fun ApplicationTestBuilder.newProject(): ProjectDto {
            val body =
                client
                    .post("/projects") {
                        contentType(ContentType.Application.Json)
                        setBody("""{"url":"https://example.com"}""")
                    }.bodyAsText()
            return json.decodeFromString(ProjectDto.serializer(), body)
        }

        suspend fun ApplicationTestBuilder.saveVersion(
            project: ProjectDto,
            diff: Diff,
        ): VersionDto {
            val request =
                json.encodeToString(
                    dev.vibemotion.api.domain.CreateVersionRequest
                        .serializer(),
                    dev.vibemotion.api.domain.CreateVersionRequest(
                        parentVersionId = project.currentVersionId,
                        catalogVersion = catalog.currentVersion,
                        diff = diff,
                    ),
                )
            val response =
                client.post("/projects/${project.id}/versions") {
                    contentType(ContentType.Application.Json)
                    setBody(request)
                }
            response.status shouldBe HttpStatusCode.Created
            return json.decodeFromString(VersionDto.serializer(), response.bodyAsText())
        }

        fun assignment(
            animationId: String = "fade-in-up",
            trigger: Trigger = Trigger.LOAD,
            params: Map<String, String> = mapOf("duration" to "600ms", "distance" to "24px"),
        ) = Assignment(animationId, catalog.currentVersion, trigger, params)

        fun hoverAssignment() =
            assignment(
                animationId = "hover-grow",
                trigger = Trigger.HOVER,
                params = mapOf("duration" to "200ms", "scale" to "1.05"),
            )

        test("a saved version exports a rewritten page, its stylesheet and nothing else") {
            withApi {
                val project = newProject()
                saveVersion(project, Diff(set = mapOf("vm-1" to assignment())))

                val response = client.get("/projects/${project.id}/export")
                response.status shouldBe HttpStatusCode.OK
                response.headers[HttpHeaders.CacheControl] shouldBe "no-store"

                val bundle = json.decodeFromString(ExportBundleDto.serializer(), response.bodyAsText())
                bundle.mode shouldBe ExportMode.FULL
                bundle.js shouldBe null
                bundle.files.map { it.name } shouldBe listOf("index.html", "vibe-motion.css")
                // The clone's `data-vm-id` is gone and its class has taken over.
                bundle.html.orEmpty() shouldContain """<h1 class="vm-a1">Hi</h1>"""
                bundle.html.orEmpty() shouldNotContain "data-vm-id"
                bundle.css shouldContain "@keyframes vm-fade-in-up-v1-1-0 {"
                bundle.css shouldContain "animation: vm-fade-in-up-v1-1-0 600ms ease-out 0ms 1 normal both;"
            }
        }

        test("an in-view assignment brings the script, the gate and the hold rule with it") {
            withApi {
                val project = newProject()
                saveVersion(project, Diff(set = mapOf("vm-1" to assignment(trigger = Trigger.IN_VIEW))))

                val bundle =
                    json.decodeFromString(
                        ExportBundleDto.serializer(),
                        client.get("/projects/${project.id}/export").bodyAsText(),
                    )

                bundle.files.map { it.name } shouldBe listOf("index.html", "vibe-motion.css", "vibe-motion.js")
                bundle.html.orEmpty() shouldContain """<h1 class="vm-a1 vm-in-view">Hi</h1>"""
                bundle.html.orEmpty() shouldContain """<script src="vibe-motion.js"></script>"""
                bundle.css shouldContain ":where(.vm-js) .vm-a1 {"
                bundle.css shouldContain ":where(.vm-js) .vm-in-view:not(.vm-play) {"
                bundle.js.orEmpty() shouldContain "IntersectionObserver"
            }
        }

        test("snippet mode returns one element's CSS and no page at all") {
            withApi {
                val project = newProject()
                saveVersion(project, Diff(set = mapOf("vm-1" to assignment())))

                val bundle =
                    json.decodeFromString(
                        ExportBundleDto.serializer(),
                        client.get("/projects/${project.id}/export?mode=snippet&vmId=vm-1").bodyAsText(),
                    )

                bundle.mode shouldBe ExportMode.SNIPPET
                bundle.html shouldBe null
                bundle.files.map { it.name } shouldBe listOf("vibe-motion.css")
                bundle.css shouldContain """/* add class="vm-a1" to the element */"""
            }
        }

        test("an older version exports the state it had, not today's") {
            withApi {
                val project = newProject()
                val first = saveVersion(project, Diff(set = mapOf("vm-1" to assignment())))
                val afterFirst = project.copy(currentVersionId = first.id)
                saveVersion(afterFirst, Diff(set = mapOf("vm-0" to hoverAssignment())))

                val older =
                    json.decodeFromString(
                        ExportBundleDto.serializer(),
                        client.get("/projects/${project.id}/export?versionId=${first.id}").bodyAsText(),
                    )
                val current =
                    json.decodeFromString(
                        ExportBundleDto.serializer(),
                        client.get("/projects/${project.id}/export").bodyAsText(),
                    )

                older.versionId shouldBe first.id
                older.css shouldNotContain ".vm-a0"
                current.css shouldContain ".vm-a0:hover {"
                current.css shouldContain ".vm-a1 {"
            }
        }

        test("the same version exported twice is byte-identical") {
            withApi {
                val project = newProject()
                saveVersion(project, Diff(set = mapOf("vm-1" to assignment())))

                val first = client.get("/projects/${project.id}/export").bodyAsText()
                val second = client.get("/projects/${project.id}/export").bodyAsText()

                second shouldBe first
            }
        }
    })
