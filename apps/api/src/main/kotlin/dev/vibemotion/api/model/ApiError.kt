package dev.vibemotion.api.model

import kotlinx.serialization.Serializable

/** The `Error` schema from openapi.yaml. Every non-2xx JSON response uses it. */
@Serializable
data class ApiError(
    val code: String,
    val message: String,
)
