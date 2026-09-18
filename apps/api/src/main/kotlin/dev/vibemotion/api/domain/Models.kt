package dev.vibemotion.api.domain

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * Wire + domain models for projects and versions. These mirror `openapi.yaml` one to one; the
 * contract is frozen (additive changes only), so a field rename here is a contract break.
 */

@Serializable
enum class Trigger {
    @SerialName("load")
    LOAD,

    @SerialName("hover")
    HOVER,

    @SerialName("in-view")
    IN_VIEW,
}

/**
 * One element's animation. CSS is never stored: it is derived from the immutable catalog entry
 * identified by ([animationId], [catalogVersion]) plus [params].
 */
@Serializable
data class Assignment(
    val animationId: String,
    val catalogVersion: String,
    val trigger: Trigger,
    val params: Map<String, String>,
)

/** Materialised map of `data-vm-id` to [Assignment]. Never persisted; see [Diff]. */
typealias State = Map<String, Assignment>

/** Delta from the parent version. [set] is applied first, then [remove]. */
@Serializable
data class Diff(
    val set: Map<String, Assignment> = emptyMap(),
    val remove: List<String> = emptyList(),
) {
    val isEmpty: Boolean get() = set.isEmpty() && remove.isEmpty()

    companion object {
        val EMPTY = Diff()
    }
}

@Serializable
data class ProjectDto(
    val id: String,
    val sourceUrl: String,
    val title: String,
    val currentVersionId: String,
    val createdAt: String,
)

@Serializable
data class VersionDto(
    val id: String,
    val projectId: String,
    val parentVersionId: String?,
    val seq: Int,
    val label: String,
    val catalogVersion: String,
    val diff: Diff,
    val createdAt: String,
)

@Serializable
data class CreateProjectRequest(
    val url: String,
)

@Serializable
data class CreateVersionRequest(
    val parentVersionId: String,
    val catalogVersion: String,
    val label: String? = null,
    val diff: Diff,
)

@Serializable
data class RestoreVersionRequest(
    val label: String? = null,
)

@Serializable
data class VersionListResponse(
    val currentVersionId: String,
    val versions: List<VersionDto>,
)

@Serializable
data class VersionStateResponse(
    val versionId: String,
    val state: State,
)

/** Body of the 409 returned when `parentVersionId` is not the project's current version. */
@Serializable
data class StaleParentErrorBody(
    val code: String,
    val message: String,
    val currentVersion: VersionDto,
)
