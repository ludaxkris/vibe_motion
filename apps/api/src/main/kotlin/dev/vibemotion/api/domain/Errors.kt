package dev.vibemotion.api.domain

/*
 * Domain failures the services raise. Each maps to exactly one status in `openapi.yaml`; the
 * mapping itself lives in the StatusPages block in Application.kt so services stay free of Ktor.
 * None of these extend IllegalArgumentException, which already has a 400 handler.
 */

/** 404: nothing with that id, or the version does not belong to the project in the path. */
class ResourceNotFoundException(
    message: String,
) : RuntimeException(message)

/**
 * 409: `parentVersionId` is not the project's current version, so something else saved first.
 * [currentVersion] is handed back so the editor can rebase or discard its draft without a re-fetch.
 */
class StaleParentException(
    val currentVersion: VersionDto,
    message: String,
) : RuntimeException(message)

/** 400: a Save whose diff changes nothing. Versions are user-initiated, so this is a client bug. */
class EmptyDiffException(
    message: String,
) : RuntimeException(message)

/**
 * 422: the diff does not resolve against the published catalog. Every problem found is reported at
 * once — a designer fixing one param key at a time through a round trip per attempt is no fun.
 */
class InvalidDiffException(
    val problems: List<String>,
) : RuntimeException(problems.joinToString("; "))
