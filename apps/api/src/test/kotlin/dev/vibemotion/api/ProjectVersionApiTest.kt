package dev.vibemotion.api

import dev.vibemotion.api.catalog.ClasspathCatalogRepository
import dev.vibemotion.api.clone.CloneException
import dev.vibemotion.api.config.DatabaseSettings
import dev.vibemotion.api.domain.Assignment
import dev.vibemotion.api.domain.CreateVersionRequest
import dev.vibemotion.api.domain.Diff
import dev.vibemotion.api.domain.ProjectDto
import dev.vibemotion.api.domain.RestoreVersionRequest
import dev.vibemotion.api.domain.StaleParentErrorBody
import dev.vibemotion.api.domain.StaleParentException
import dev.vibemotion.api.domain.Trigger
import dev.vibemotion.api.domain.VersionDto
import dev.vibemotion.api.domain.VersionListResponse
import dev.vibemotion.api.domain.VersionStateResponse
import dev.vibemotion.api.model.ApiError
import dev.vibemotion.api.persistence.AppDatabase
import dev.vibemotion.api.persistence.ExposedTransactionRunner
import dev.vibemotion.api.persistence.Projects
import dev.vibemotion.api.persistence.Versions
import dev.vibemotion.api.projects.ExposedProjectRepository
import dev.vibemotion.api.projects.ProjectService
import dev.vibemotion.api.versions.DiffValidator
import dev.vibemotion.api.versions.ExposedVersionRepository
import dev.vibemotion.api.versions.VersionService
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import io.kotest.matchers.types.shouldBeInstanceOf
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.vendors.ForUpdateOption
import org.jetbrains.exposed.v1.jdbc.select
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.utility.DockerImageName
import java.util.UUID
import java.util.concurrent.CountDownLatch
import kotlin.concurrent.thread

/**
 * The projects and versions half of the API, end to end against a real Postgres. The clone
 * pipeline is faked (it lands in a parallel worktree); everything else is the production wiring.
 */
class ProjectVersionApiTest :
    FunSpec({

        val postgres = PostgreSQLContainer<Nothing>(DockerImageName.parse("postgres:16-alpine"))
        val catalog = ClasspathCatalogRepository.load()
        val cloner = FakePageCloner()
        val services = testServices(catalog, cloner)
        val json =
            Json {
                ignoreUnknownKeys = true
                encodeDefaults = true
            }
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

        fun assignment(
            animationId: String = "fade-in-up",
            trigger: Trigger = Trigger.LOAD,
            params: Map<String, String> = mapOf("duration" to "600ms", "distance" to "24px"),
            catalogVersion: String = catalog.currentVersion,
        ) = Assignment(animationId, catalogVersion, trigger, params)

        suspend fun ApplicationTestBuilder.postProject(url: String = "https://example.com"): HttpResponse =
            client.post("/projects") {
                contentType(ContentType.Application.Json)
                setBody("""{"url":"$url"}""")
            }

        suspend fun ApplicationTestBuilder.newProject(): ProjectDto =
            json.decodeFromString(ProjectDto.serializer(), postProject().bodyAsText())

        suspend fun ApplicationTestBuilder.postVersion(
            projectId: String,
            parentVersionId: String,
            diff: Diff,
            label: String? = null,
            catalogVersion: String = catalog.currentVersion,
        ): HttpResponse =
            client.post("/projects/$projectId/versions") {
                contentType(ContentType.Application.Json)
                setBody(
                    json.encodeToString(
                        CreateVersionRequest.serializer(),
                        CreateVersionRequest(parentVersionId, catalogVersion, label, diff),
                    ),
                )
            }

        suspend fun ApplicationTestBuilder.save(
            projectId: String,
            parentVersionId: String,
            diff: Diff,
            label: String? = null,
        ): VersionDto {
            val response = postVersion(projectId, parentVersionId, diff, label)
            response.status shouldBe HttpStatusCode.Created
            return json.decodeFromString(VersionDto.serializer(), response.bodyAsText())
        }

        suspend fun ApplicationTestBuilder.versions(projectId: String): VersionListResponse =
            json.decodeFromString(VersionListResponse.serializer(), client.get("/projects/$projectId/versions").bodyAsText())

        suspend fun ApplicationTestBuilder.stateAt(
            projectId: String,
            versionId: String,
        ): VersionStateResponse =
            json.decodeFromString(
                VersionStateResponse.serializer(),
                client.get("/projects/$projectId/versions/$versionId/state").bodyAsText(),
            )

        fun errorOf(body: String): ApiError = json.decodeFromString(ApiError.serializer(), body)

        // --- projects ------------------------------------------------------------------------

        test("POST /projects clones the page and creates version 0") {
            withApi {
                val response = postProject("https://example.com/landing")

                response.status shouldBe HttpStatusCode.Created
                val project = json.decodeFromString(ProjectDto.serializer(), response.bodyAsText())
                project.title shouldBe FAKE_CLONE.title
                // The URL the content was finally served from, not necessarily the one submitted.
                project.sourceUrl shouldBe FAKE_CLONE.finalUrl
                cloner.requestedUrls shouldContainExactly listOf("https://example.com/landing")

                val history = versions(project.id)
                history.currentVersionId shouldBe project.currentVersionId
                history.versions.map { it.seq } shouldContainExactly listOf(0)
                val initial = history.versions.single()
                initial.id shouldBe project.currentVersionId
                initial.parentVersionId shouldBe null
                initial.label shouldBe ProjectService.INITIAL_VERSION_LABEL
                initial.catalogVersion shouldBe catalog.currentVersion
                initial.diff shouldBe Diff.EMPTY
            }
        }

        test("version 0 is stored as an explicit empty diff, not as an empty object") {
            withApi {
                val project = newProject()

                val stored =
                    transaction {
                        Versions
                            .selectAll()
                            .where { Versions.projectId eq UUID.fromString(project.id) }
                            .single()[Versions.diff]
                            .toString()
                    }

                stored shouldBe """{"set":{},"remove":[]}"""
            }
        }

        test("every clone failure maps to its status and code, and no project is left behind") {
            val cases =
                listOf<Triple<() -> CloneException, HttpStatusCode, String>>(
                    Triple({ CloneException.InvalidUrl("not an http url") }, HttpStatusCode.BadRequest, "invalid_url"),
                    Triple({ CloneException.Blocked("private range") }, HttpStatusCode.UnprocessableEntity, "url_blocked"),
                    Triple({ CloneException.Unreachable("timed out") }, HttpStatusCode.UnprocessableEntity, "url_unreachable"),
                    Triple({ CloneException.NotHtml("application/pdf") }, HttpStatusCode.UnprocessableEntity, "not_html"),
                    Triple({ CloneException.TooLarge("12 MB") }, HttpStatusCode.PayloadTooLarge, "page_too_large"),
                )

            withApi {
                cases.forEach { (failure, status, code) ->
                    cloner.failure = failure

                    val response = postProject()

                    response.status shouldBe status
                    errorOf(response.bodyAsText()).code shouldBe code
                }
            }
        }

        test("GET /projects/{id} returns the project, 404 for an unknown id and 400 for a malformed one") {
            withApi {
                val project = newProject()

                val found = client.get("/projects/${project.id}")
                found.status shouldBe HttpStatusCode.OK
                json.decodeFromString(ProjectDto.serializer(), found.bodyAsText()) shouldBe project

                val missing = client.get("/projects/${UUID.randomUUID()}")
                missing.status shouldBe HttpStatusCode.NotFound
                errorOf(missing.bodyAsText()).code shouldBe "not_found"

                val malformed = client.get("/projects/not-a-uuid")
                malformed.status shouldBe HttpStatusCode.BadRequest
                errorOf(malformed.bodyAsText()).code shouldBe "bad_request"
            }
        }

        test("DELETE /projects/{id} removes the project and every version") {
            withApi {
                val project = newProject()
                save(project.id, project.currentVersionId, Diff(set = mapOf("vm-1" to assignment())))

                client.delete("/projects/${project.id}").status shouldBe HttpStatusCode.NoContent

                client.get("/projects/${project.id}").status shouldBe HttpStatusCode.NotFound
                client.get("/projects/${project.id}/versions").status shouldBe HttpStatusCode.NotFound
                transaction {
                    Versions.selectAll().where { Versions.projectId eq UUID.fromString(project.id) }.count()
                } shouldBe 0L

                client.delete("/projects/${project.id}").status shouldBe HttpStatusCode.NotFound
            }
        }

        test("GET /projects/{id}/page serves the rendered document with a CSP") {
            withApi {
                val project = newProject()

                val response = client.get("/projects/${project.id}/page")

                response.status shouldBe HttpStatusCode.OK
                response.contentType()?.withoutParameters() shouldBe ContentType.Text.Html
                response.headers["Content-Security-Policy"] shouldBe FAKE_CSP
                response.headers["X-Content-Type-Options"] shouldBe "nosniff"
                val body = response.bodyAsText()
                body shouldContain "data-vm-id=\"vm-1\""
                // Added at serve time by the renderer, so it is not part of the stored base_html.
                body shouldContain "vm-bridge.js"

                client.get("/projects/${UUID.randomUUID()}/page").status shouldBe HttpStatusCode.NotFound
            }
        }

        test("the page is revalidatable and never referrer-leaks the project URL") {
            withApi {
                val project = newProject()

                val first = client.get("/projects/${project.id}/page")

                first.headers[HttpHeaders.CacheControl] shouldBe "private, no-cache"
                // The project URL is a capability in v0, so no request the cloned page makes may
                // carry it — not even as an origin.
                first.headers["Referrer-Policy"] shouldBe "no-referrer"
                val etag = first.headers[HttpHeaders.ETag].shouldNotBeNull()

                val revalidated = client.get("/projects/${project.id}/page") { header(HttpHeaders.IfNoneMatch, etag) }
                revalidated.status shouldBe HttpStatusCode.NotModified
                revalidated.bodyAsText() shouldBe ""
                revalidated.headers[HttpHeaders.ETag] shouldBe etag

                // base_html is immutable, so the validator is stable across requests...
                client.get("/projects/${project.id}/page").headers[HttpHeaders.ETag] shouldBe etag
                // ...and scoped to the project, so one project's cache can never answer another's.
                val other = newProject()
                other.id shouldNotBe project.id
                val otherPage = client.get("/projects/${other.id}/page") { header(HttpHeaders.IfNoneMatch, etag) }
                otherPage.status shouldBe HttpStatusCode.OK
            }
        }

        test("a validated page request for a deleted project is a 404, not a 304") {
            // The 304 path deliberately does not read base_html, so it has to check existence
            // some other way; if it did not, a deleted project would keep serving from cache.
            withApi {
                val project = newProject()
                val etag = client.get("/projects/${project.id}/page").headers[HttpHeaders.ETag].shouldNotBeNull()
                client.delete("/projects/${project.id}").status shouldBe HttpStatusCode.NoContent

                val response = client.get("/projects/${project.id}/page") { header(HttpHeaders.IfNoneMatch, etag) }

                response.status shouldBe HttpStatusCode.NotFound
                errorOf(response.bodyAsText()).code shouldBe "not_found"
            }
        }

        test("a project with a huge base_html is not carried on metadata reads") {
            // Guards the split between ProjectRow and baseHtml(): the document only travels when
            // the page endpoint asks for it.
            cloner.page = FAKE_CLONE.copy(html = "<html><body>" + "x".repeat(200_000) + "</body></html>")
            withApi {
                val project = newProject()

                client.get("/projects/${project.id}").bodyAsText() shouldNotContain "xxxxxxxxxx"
                client.get("/projects/${project.id}/page").bodyAsText() shouldContain "xxxxxxxxxx"
            }
        }

        // --- versions ------------------------------------------------------------------------

        test("POST versions appends a version, advances the current pointer and keeps history ordered") {
            withApi {
                val project = newProject()

                val v1 = save(project.id, project.currentVersionId, Diff(set = mapOf("vm-1" to assignment())))
                v1.seq shouldBe 1
                v1.parentVersionId shouldBe project.currentVersionId

                val v2 = save(project.id, v1.id, Diff(set = mapOf("vm-2" to assignment("pulse", params = mapOf("scale" to "1.1")))))
                v2.seq shouldBe 2
                v2.parentVersionId shouldBe v1.id

                val history = versions(project.id)
                history.currentVersionId shouldBe v2.id
                history.versions.map { it.seq } shouldContainExactly listOf(0, 1, 2)
                history.versions.map { it.id } shouldContainExactly listOf(project.currentVersionId, v1.id, v2.id)
            }
        }

        test("a save without a label gets one generated from its diff") {
            withApi {
                val project = newProject()

                val v1 =
                    save(
                        project.id,
                        project.currentVersionId,
                        Diff(set = mapOf("vm-17" to assignment()), remove = listOf("vm-42")),
                    )

                v1.label shouldBe "Fade In Up on vm-17, removed vm-42"
            }
        }

        test("a save with a label keeps it") {
            withApi {
                val project = newProject()

                save(project.id, project.currentVersionId, Diff(set = mapOf("vm-1" to assignment())), label = "Hero entrance")
                    .label shouldBe "Hero entrance"
            }
        }

        test("a label longer than the contract's cap is a 400 on save and on restore") {
            withApi {
                val project = newProject()
                val tooLong = "x".repeat(201)

                postVersion(project.id, project.currentVersionId, Diff(set = mapOf("vm-1" to assignment())), label = tooLong)
                    .status shouldBe HttpStatusCode.BadRequest

                val restore =
                    client.post("/projects/${project.id}/versions/${project.currentVersionId}/restore") {
                        contentType(ContentType.Application.Json)
                        setBody(json.encodeToString(RestoreVersionRequest.serializer(), RestoreVersionRequest(tooLong)))
                    }
                restore.status shouldBe HttpStatusCode.BadRequest

                versions(project.id).versions.map { it.seq } shouldContainExactly listOf(0)
            }
        }

        test("a second save against the same parent is a 409 carrying the version it lost to") {
            withApi {
                val project = newProject()
                val parent = project.currentVersionId
                val winner = save(project.id, parent, Diff(set = mapOf("vm-1" to assignment())))

                val response = postVersion(project.id, parent, Diff(set = mapOf("vm-2" to assignment())))

                response.status shouldBe HttpStatusCode.Conflict
                val body = json.decodeFromString(StaleParentErrorBody.serializer(), response.bodyAsText())
                body.code shouldBe "stale_parent"
                body.currentVersion.id shouldBe winner.id
                body.currentVersion.seq shouldBe 1
                versions(project.id).versions.map { it.seq } shouldContainExactly listOf(0, 1)
            }
        }

        test("a save whose diff changes nothing is a 400") {
            withApi {
                val project = newProject()

                val response = postVersion(project.id, project.currentVersionId, Diff.EMPTY)

                response.status shouldBe HttpStatusCode.BadRequest
                errorOf(response.bodyAsText()).code shouldBe "empty_diff"
            }
        }

        test("a diff that does not resolve against the catalog is a 422") {
            val set = mapOf("vm-1" to assignment())
            val cases =
                mapOf(
                    "unknown request catalog version" to Pair(Diff(set = set), "9.9.9"),
                    "unknown pinned catalog version" to
                        Pair(Diff(set = mapOf("vm-1" to assignment(catalogVersion = "9.9.9"))), catalog.currentVersion),
                    "unknown animation" to Pair(Diff(set = mapOf("vm-1" to assignment("moonwalk"))), catalog.currentVersion),
                    "undeclared param" to
                        Pair(Diff(set = mapOf("vm-1" to assignment(params = mapOf("wobble" to "3")))), catalog.currentVersion),
                    "disallowed trigger" to
                        Pair(Diff(set = mapOf("vm-1" to assignment(trigger = Trigger.HOVER))), catalog.currentVersion),
                    "malformed element id" to Pair(Diff(set = mapOf("h1.hero" to assignment())), catalog.currentVersion),
                    "malformed element id in remove" to Pair(Diff(remove = listOf("h1.hero")), catalog.currentVersion),
                )

            withApi {
                val project = newProject()

                cases.forEach { (name, case) ->
                    val (diff, catalogVersion) = case
                    val response = postVersion(project.id, project.currentVersionId, diff, catalogVersion = catalogVersion)

                    withClue(name) {
                        response.status shouldBe HttpStatusCode.UnprocessableEntity
                        errorOf(response.bodyAsText()).code shouldBe "invalid_diff"
                    }
                }

                // Nothing was written by any of them.
                versions(project.id).versions.map { it.seq } shouldContainExactly listOf(0)
            }
        }

        test("a save whose diff exceeds the entry cap is a 422 and writes nothing") {
            withApi {
                val project = newProject()
                val diff = Diff(remove = (1..2_001).map { "vm-$it" })

                val response = postVersion(project.id, project.currentVersionId, diff)

                response.status shouldBe HttpStatusCode.UnprocessableEntity
                val error = errorOf(response.bodyAsText())
                error.code shouldBe "invalid_diff"
                error.message shouldContain "at most 2000 are allowed"
                versions(project.id).versions.map { it.seq } shouldContainExactly listOf(0)
            }
        }

        test("a JSON body over the cap is a 413 on save and on restore, and writes nothing") {
            withApi {
                val project = newProject()
                val huge = "x".repeat(300_000)

                val save =
                    client.post("/projects/${project.id}/versions") {
                        contentType(ContentType.Application.Json)
                        setBody("""{"parentVersionId":"${project.currentVersionId}","catalogVersion":"1.0.0","label":"$huge","diff":{}}""")
                    }
                save.status shouldBe HttpStatusCode.PayloadTooLarge
                errorOf(save.bodyAsText()).code shouldBe "payload_too_large"

                val restore =
                    client.post("/projects/${project.id}/versions/${project.currentVersionId}/restore") {
                        contentType(ContentType.Application.Json)
                        setBody("""{"label":"$huge"}""")
                    }
                restore.status shouldBe HttpStatusCode.PayloadTooLarge
                errorOf(restore.bodyAsText()).code shouldBe "payload_too_large"

                versions(project.id).versions.map { it.seq } shouldContainExactly listOf(0)
            }
        }

        test("a save against an unknown project or with a malformed parent id fails without writing") {
            withApi {
                val project = newProject()
                val diff = Diff(set = mapOf("vm-1" to assignment()))

                postVersion(UUID.randomUUID().toString(), project.currentVersionId, diff).status shouldBe HttpStatusCode.NotFound
                postVersion(project.id, "not-a-uuid", diff).status shouldBe HttpStatusCode.BadRequest
            }
        }

        // --- state ---------------------------------------------------------------------------

        test("GET state folds the diffs from v0, including removals") {
            withApi {
                val project = newProject()
                val hero = assignment(params = mapOf("duration" to "600ms", "distance" to "24px"))
                val cta = assignment("pulse", trigger = Trigger.HOVER, params = mapOf("scale" to "1.1"))

                val v1 = save(project.id, project.currentVersionId, Diff(set = mapOf("vm-17" to hero)))
                val v2 = save(project.id, v1.id, Diff(set = mapOf("vm-42" to cta)))
                val retuned = assignment(params = mapOf("duration" to "900ms", "distance" to "40px"))
                val v3 = save(project.id, v2.id, Diff(set = mapOf("vm-17" to retuned), remove = listOf("vm-42")))

                stateAt(project.id, project.currentVersionId).state shouldBe emptyMap()
                stateAt(project.id, v1.id).state shouldBe mapOf("vm-17" to hero)
                stateAt(project.id, v2.id).state shouldBe mapOf("vm-17" to hero, "vm-42" to cta)
                stateAt(project.id, v3.id).state shouldBe mapOf("vm-17" to retuned)
            }
        }

        test("a version id from another project reads as not found") {
            withApi {
                val mine = newProject()
                val theirs = newProject()

                client.get("/projects/${mine.id}/versions/${theirs.currentVersionId}/state").status shouldBe HttpStatusCode.NotFound
                client.post("/projects/${mine.id}/versions/${theirs.currentVersionId}/restore").status shouldBe HttpStatusCode.NotFound
                client.get("/projects/${mine.id}/versions/${UUID.randomUUID()}/state").status shouldBe HttpStatusCode.NotFound
            }
        }

        // --- restore -------------------------------------------------------------------------

        test("restore appends a version whose state matches the target and leaves history untouched") {
            withApi {
                val project = newProject()
                val hero = assignment()
                val cta = assignment("pulse", trigger = Trigger.HOVER, params = mapOf("scale" to "1.1"))
                val v1 = save(project.id, project.currentVersionId, Diff(set = mapOf("vm-17" to hero)))
                val v2 = save(project.id, v1.id, Diff(set = mapOf("vm-42" to cta)))
                val before = versions(project.id).versions

                val response = client.post("/projects/${project.id}/versions/${v1.id}/restore")

                response.status shouldBe HttpStatusCode.Created
                val restored = json.decodeFromString(VersionDto.serializer(), response.bodyAsText())
                restored.seq shouldBe 3
                restored.parentVersionId shouldBe v2.id
                restored.label shouldBe "Restored v1"
                restored.diff shouldBe Diff(remove = listOf("vm-42"))

                stateAt(project.id, restored.id).state shouldBe stateAt(project.id, v1.id).state
                val after = versions(project.id)
                after.currentVersionId shouldBe restored.id
                after.versions.take(3) shouldContainExactly before
            }
        }

        test("restore accepts a label and defaults to naming the version it reproduces") {
            withApi {
                val project = newProject()
                val v1 = save(project.id, project.currentVersionId, Diff(set = mapOf("vm-1" to assignment())))
                save(project.id, v1.id, Diff(set = mapOf("vm-2" to assignment())))

                val response =
                    client.post("/projects/${project.id}/versions/${v1.id}/restore") {
                        contentType(ContentType.Application.Json)
                        setBody("""{"label":"Back to the first pass"}""")
                    }

                json.decodeFromString(VersionDto.serializer(), response.bodyAsText()).label shouldBe "Back to the first pass"
            }
        }

        test("restoring the state the project is already in still records an explicit, empty version") {
            withApi {
                val project = newProject()
                val v1 = save(project.id, project.currentVersionId, Diff(set = mapOf("vm-1" to assignment())))

                val response = client.post("/projects/${project.id}/versions/${v1.id}/restore")

                response.status shouldBe HttpStatusCode.Created
                val restored = json.decodeFromString(VersionDto.serializer(), response.bodyAsText())
                restored.seq shouldBe 2
                restored.diff shouldBe Diff.EMPTY
                versions(project.id).currentVersionId shouldBe restored.id
            }
        }

        test("restore answers in exactly the shape a save does, pinning the TARGET's catalogVersion") {
            // The editor treats both 201s with one code path, so the field set must not diverge.
            // catalogVersion is informational and is the target's on purpose: a restored version
            // reads as a copy of what it reproduces, while the pins that decide the CSS travel
            // inside each assignment in the diff.
            withApi {
                val project = newProject()
                val saved = postVersion(project.id, project.currentVersionId, Diff(set = mapOf("vm-1" to assignment())))
                val v1 = json.decodeFromString(VersionDto.serializer(), saved.bodyAsText())
                save(project.id, v1.id, Diff(set = mapOf("vm-2" to assignment())))

                val restored = client.post("/projects/${project.id}/versions/${v1.id}/restore")

                restored.status shouldBe saved.status
                val restoredFields = json.parseToJsonElement(restored.bodyAsText()).jsonObject.keys
                restoredFields shouldContainExactly json.parseToJsonElement(saved.bodyAsText()).jsonObject.keys
                json.decodeFromString(VersionDto.serializer(), restored.bodyAsText()).catalogVersion shouldBe v1.catalogVersion
            }
        }

        test("restoring version 0 clears every assignment") {
            withApi {
                val project = newProject()
                val v1 = save(project.id, project.currentVersionId, Diff(set = mapOf("vm-1" to assignment())))
                save(project.id, v1.id, Diff(set = mapOf("vm-2" to assignment())))

                val response = client.post("/projects/${project.id}/versions/${project.currentVersionId}/restore")
                val restored = json.decodeFromString(VersionDto.serializer(), response.bodyAsText())

                stateAt(project.id, restored.id).state shouldBe emptyMap()
            }
        }

        // --- concurrency ---------------------------------------------------------------------

        test("eight saves racing on the same parent produce exactly one new version") {
            // Eight racers, not two: the pool holds eight connections, so this also exercises
            // every waiter pinning one while blocked on the project row lock. Seven of them must
            // come back as an ordinary 409, none as a timeout and none as a duplicate seq.
            withApi {
                val project = newProject()
                val projectId = UUID.fromString(project.id)
                val parent = project.currentVersionId

                fun request(vmId: String) =
                    CreateVersionRequest(parent, catalog.currentVersion, null, Diff(set = mapOf(vmId to assignment())))

                val outcomes =
                    coroutineScope {
                        (1..8)
                            .map { racer ->
                                async(Dispatchers.IO) { runCatching { services.versions.create(projectId, request("vm-$racer")) } }
                            }.awaitAll()
                    }

                outcomes.count { it.isSuccess } shouldBe 1
                outcomes.filter { it.isFailure }.let { losers ->
                    losers shouldHaveSize 7
                    losers.forEach { it.exceptionOrNull().shouldBeInstanceOf<StaleParentException>() }
                }

                val history = versions(project.id)
                history.versions.map { it.seq } shouldContainExactly listOf(0, 1)
                history.currentVersionId shouldNotBe parent
                // The unique index is the backstop, not the mechanism; assert the mechanism held.
                val stored =
                    transaction {
                        Versions
                            .select(Versions.seq)
                            .where { Versions.projectId eq projectId }
                            .map { it[Versions.seq] }
                    }
                stored shouldContainExactly stored.distinct()
            }
        }

        test("a save that cannot take the project lock in time is a retryable 503, not a stuck connection") {
            // With lock_timeout unset, a stalled holder parks every waiter's pooled connection
            // until Hikari's connection timeout, turning one slow save into a pool-wide outage.
            val impatient =
                VersionService(
                    ExposedProjectRepository(lockTimeout = "100ms"),
                    ExposedVersionRepository(),
                    DiffValidator(catalog),
                    catalog,
                    ExposedTransactionRunner(),
                )

            testApplication {
                application { apiModule(config(), catalog, database, services.copy(versions = impatient)) }

                val project = json.decodeFromString(ProjectDto.serializer(), postProject().bodyAsText())
                val projectId = UUID.fromString(project.id)
                val locked = CountDownLatch(1)
                val release = CountDownLatch(1)

                val holder =
                    thread {
                        transaction {
                            Projects
                                .selectAll()
                                .where { Projects.id eq projectId }
                                .forUpdate(ForUpdateOption.ForUpdate)
                                .single()
                            locked.countDown()
                            release.await()
                        }
                    }

                try {
                    locked.await()
                    val response =
                        client.post("/projects/${project.id}/versions") {
                            contentType(ContentType.Application.Json)
                            setBody(
                                json.encodeToString(
                                    CreateVersionRequest.serializer(),
                                    CreateVersionRequest(
                                        project.currentVersionId,
                                        catalog.currentVersion,
                                        null,
                                        Diff(set = mapOf("vm-1" to assignment())),
                                    ),
                                ),
                            )
                        }

                    response.status shouldBe HttpStatusCode.ServiceUnavailable
                    response.headers[HttpHeaders.RetryAfter] shouldBe "1"
                    errorOf(response.bodyAsText()).code shouldBe "project_busy"
                } finally {
                    release.countDown()
                    holder.join()
                }
            }
        }
    })
