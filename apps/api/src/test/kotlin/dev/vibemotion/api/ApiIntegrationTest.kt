package dev.vibemotion.api

import dev.vibemotion.api.catalog.ClasspathCatalogRepository
import dev.vibemotion.api.config.DatabaseSettings
import dev.vibemotion.api.model.ApiError
import dev.vibemotion.api.persistence.AppDatabase
import dev.vibemotion.api.persistence.Projects
import dev.vibemotion.api.persistence.Versions
import dev.vibemotion.api.routes.HealthResponse
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.shouldBe
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.utility.DockerImageName
import java.sql.DriverManager
import java.time.OffsetDateTime
import java.util.UUID

/**
 * End-to-end against a real Postgres: Flyway migrates the baseline, the Exposed tables match the
 * migration, and the HTTP surface behaves as openapi.yaml says.
 */
class ApiIntegrationTest :
    FunSpec({

        val postgres = PostgreSQLContainer<Nothing>(DockerImageName.parse("postgres:16-alpine"))
        val json = Json { ignoreUnknownKeys = true }
        val catalog = ClasspathCatalogRepository.load()
        lateinit var database: AppDatabase

        beforeSpec {
            postgres.start()
            database = AppDatabase.start(DatabaseSettings(postgres.jdbcUrl, postgres.username, postgres.password))
        }

        afterSpec {
            database.close()
            postgres.stop()
        }

        fun config() =
            testConfig(
                database = DatabaseSettings(postgres.jdbcUrl, postgres.username, postgres.password),
            )

        test("GET /health returns 200 with db ok once Flyway has migrated") {
            testApplication {
                application { apiModule(config(), catalog, database) }

                val response = client.get("/health")

                response.status shouldBe HttpStatusCode.OK
                val health = json.decodeFromString<HealthResponse>(response.bodyAsText())
                health.status shouldBe "ok"
                health.db shouldBe "ok"
                health.version shouldBe "test"
            }
        }

        test("GET /catalog returns the current catalog version") {
            testApplication {
                application { apiModule(config(), catalog, database) }

                val response = client.get("/catalog")

                response.status shouldBe HttpStatusCode.OK
                response.bodyAsText() shouldBe catalog.rawJson(catalog.currentVersion)
            }
        }

        test("GET /catalog/9.9.9 returns 404 with an Error body") {
            testApplication {
                application { apiModule(config(), catalog, database) }

                val response = client.get("/catalog/9.9.9")

                response.status shouldBe HttpStatusCode.NotFound
                json.decodeFromString<ApiError>(response.bodyAsText()).code shouldBe "not_found"
            }
        }

        test("versions has exactly one index backing (project_id, seq)") {
            // `unique (project_id, seq)` already creates a btree over exactly those columns. A
            // second, non-unique copy of it serves no query the first cannot, and costs every
            // insert an extra index write plus the disk to keep it on.
            val covering = mutableListOf<String>()
            DriverManager.getConnection(postgres.jdbcUrl, postgres.username, postgres.password).use { connection ->
                connection.createStatement().use { statement ->
                    val sql = "select indexname, indexdef from pg_indexes where tablename = 'versions' order by indexname"
                    statement.executeQuery(sql).use { rows ->
                        while (rows.next()) {
                            if (rows.getString("indexdef").contains("(project_id, seq)")) {
                                covering += rows.getString("indexname")
                            }
                        }
                    }
                }
            }

            covering shouldBe listOf("versions_project_id_seq_key")
        }

        test("the Exposed tables round-trip against the baseline migration") {
            val newProjectId = UUID.randomUUID()
            val newVersionId = UUID.randomUUID()
            val now = OffsetDateTime.now()

            transaction {
                Projects.insert {
                    it[id] = newProjectId
                    it[sourceUrl] = "https://example.com/"
                    it[title] = "Example"
                    it[baseHtml] = "<html data-vm-id=\"vm-0\"></html>"
                    it[createdAt] = now
                }
                Versions.insert {
                    it[id] = newVersionId
                    it[projectId] = newProjectId
                    it[parentVersionId] = null
                    it[seq] = 0
                    it[label] = "Initial"
                    it[catalogVersion] = catalog.currentVersion
                    it[diff] = buildJsonObject { put("set", buildJsonObject { }) }
                    it[createdAt] = now
                }
                Projects.update({ Projects.id eq newProjectId }) { it[currentVersionId] = newVersionId }
            }

            transaction {
                val project = Projects.selectAll().where { Projects.id eq newProjectId }.single()
                project[Projects.title] shouldBe "Example"
                project[Projects.currentVersionId] shouldBe newVersionId

                val version = Versions.selectAll().where { Versions.projectId eq newProjectId }.single()
                version[Versions.seq] shouldBe 0
                version[Versions.catalogVersion] shouldBe catalog.currentVersion
            }

            // Deleting a project cascades to its versions; the deferred FK from projects makes the
            // circular reference between the two tables workable inside one transaction.
            transaction {
                Projects.deleteWhere { Projects.id eq newProjectId }
                Versions.selectAll().where { Versions.projectId eq newProjectId }.count() shouldBe 0L
            }
        }
    })
