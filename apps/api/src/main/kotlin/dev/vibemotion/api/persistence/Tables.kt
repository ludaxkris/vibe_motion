package dev.vibemotion.api.persistence

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.jetbrains.exposed.v1.core.ReferenceOption
import org.jetbrains.exposed.v1.core.Table
import org.jetbrains.exposed.v1.core.java.javaUUID
import org.jetbrains.exposed.v1.javatime.timestampWithTimeZone
import org.jetbrains.exposed.v1.json.jsonb

private val databaseJson = Json

/**
 * Exposed mirrors of `db/migration/V1__baseline.sql`. Flyway owns the schema; these objects only
 * describe it. Keep the two in step — `ApiIntegrationTest` round-trips both and fails if they disagree.
 */
object Projects : Table("projects") {
    val id = javaUUID("id")
    val sourceUrl = text("source_url")
    val title = text("title")
    val baseHtml = text("base_html")

    /**
     * FK to `versions.id` is declared in the migration as DEFERRABLE INITIALLY DEFERRED (the two
     * tables reference each other). It is deliberately not modelled here, to keep the two table
     * objects free of a circular initialisation dependency.
     */
    val currentVersionId = javaUUID("current_version_id").nullable()
    val createdAt = timestampWithTimeZone("created_at")

    override val primaryKey = PrimaryKey(id)
}

object Versions : Table("versions") {
    val id = javaUUID("id")
    val projectId = reference("project_id", Projects.id, onDelete = ReferenceOption.CASCADE)
    val parentVersionId = optReference("parent_version_id", id)
    val seq = integer("seq")
    val label = text("label")
    val catalogVersion = text("catalog_version")
    val diff = jsonb<JsonObject>("diff", databaseJson)
    val createdAt = timestampWithTimeZone("created_at")

    override val primaryKey = PrimaryKey(id)

    init {
        uniqueIndex("versions_project_id_seq_key", projectId, seq)
        index("versions_project_id_seq_idx", false, projectId, seq)
    }
}
