package dev.vibemotion.api.versions

import dev.vibemotion.api.domain.Diff
import dev.vibemotion.api.domain.VersionDto
import dev.vibemotion.api.persistence.Versions
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.lessEq
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.select
import org.jetbrains.exposed.v1.jdbc.selectAll
import java.time.OffsetDateTime
import java.util.UUID

/**
 * `encodeDefaults` matters: an empty diff must land in Postgres as `{"set":{},"remove":[]}`, the
 * shape `openapi.yaml` declares, not as `{}`.
 */
private val diffJson = Json { encodeDefaults = true }

/** A `versions` row. */
data class VersionRow(
    val id: UUID,
    val projectId: UUID,
    val parentVersionId: UUID?,
    val seq: Int,
    val label: String,
    val catalogVersion: String,
    val diff: Diff,
    val createdAt: OffsetDateTime,
) {
    fun toDto(): VersionDto =
        VersionDto(
            id = id.toString(),
            projectId = projectId.toString(),
            parentVersionId = parentVersionId?.toString(),
            seq = seq,
            label = label,
            catalogVersion = catalogVersion,
            diff = diff,
            createdAt = createdAt.toString(),
        )
}

/** Persistence for versions. Every method must be called inside a [dev.vibemotion.api.persistence.TransactionRunner] unit of work. */
interface VersionRepository {
    fun insert(version: VersionRow)

    /** Scoped by project on purpose: a version id from another project must read as "not found". */
    fun find(
        projectId: UUID,
        versionId: UUID,
    ): VersionRow?

    /** Ascending by `seq`, v0 first. */
    fun listByProject(projectId: UUID): List<VersionRow>

    /** The diffs of every version up to and including [throughSeq], in `seq` order. History is linear. */
    fun diffsUpTo(
        projectId: UUID,
        throughSeq: Int,
    ): List<Diff>
}

class ExposedVersionRepository : VersionRepository {
    override fun insert(version: VersionRow) {
        Versions.insert {
            it[id] = version.id
            it[projectId] = version.projectId
            it[parentVersionId] = version.parentVersionId
            it[seq] = version.seq
            it[label] = version.label
            it[catalogVersion] = version.catalogVersion
            it[diff] = version.diff.toJsonObject()
            it[createdAt] = version.createdAt
        }
    }

    override fun find(
        projectId: UUID,
        versionId: UUID,
    ): VersionRow? =
        Versions
            .selectAll()
            .where { (Versions.id eq versionId) and (Versions.projectId eq projectId) }
            .singleOrNull()
            ?.toVersionRow()

    override fun listByProject(projectId: UUID): List<VersionRow> =
        Versions
            .selectAll()
            .where { Versions.projectId eq projectId }
            .orderBy(Versions.seq to SortOrder.ASC)
            .map { it.toVersionRow() }

    override fun diffsUpTo(
        projectId: UUID,
        throughSeq: Int,
    ): List<Diff> =
        Versions
            .select(Versions.diff, Versions.seq)
            .where { (Versions.projectId eq projectId) and (Versions.seq lessEq throughSeq) }
            .orderBy(Versions.seq to SortOrder.ASC)
            .map { it[Versions.diff].toDiff() }

    private fun ResultRow.toVersionRow() =
        VersionRow(
            id = this[Versions.id],
            projectId = this[Versions.projectId],
            parentVersionId = this[Versions.parentVersionId],
            seq = this[Versions.seq],
            label = this[Versions.label],
            catalogVersion = this[Versions.catalogVersion],
            diff = this[Versions.diff].toDiff(),
            createdAt = this[Versions.createdAt],
        )
}

internal fun Diff.toJsonObject(): JsonObject = diffJson.encodeToJsonElement(Diff.serializer(), this).jsonObject

internal fun JsonObject.toDiff(): Diff = diffJson.decodeFromJsonElement(Diff.serializer(), this)
