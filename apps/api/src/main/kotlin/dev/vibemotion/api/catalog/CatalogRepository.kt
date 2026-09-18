package dev.vibemotion.api.catalog

import kotlinx.serialization.json.Json
import org.slf4j.LoggerFactory

/**
 * Read access to the published animation catalog versions bundled with the service.
 *
 * Catalog files are immutable once merged (see CLAUDE.md), so everything is loaded once at
 * startup and served from memory.
 */
interface CatalogRepository {
    /** The version the editor authors against (`packages/animation-catalog/current`). */
    val currentVersion: String

    /** Every published version, ascending by semver. */
    fun versions(): List<String>

    /** The parsed catalog for [version], or null when it is not a published version. */
    fun catalog(version: String): Catalog?

    /** The catalog file for [version] verbatim, so clients get byte-identical data. */
    fun rawJson(version: String): String?
}

/**
 * Loads the catalog from the jar resources under `catalog/`, populated at build time by the
 * `catalogResources` Gradle task from `packages/animation-catalog`.
 */
class ClasspathCatalogRepository private constructor(
    override val currentVersion: String,
    private val ordered: List<String>,
    private val parsed: Map<String, Catalog>,
    private val raw: Map<String, String>,
) : CatalogRepository {
    override fun versions(): List<String> = ordered

    override fun catalog(version: String): Catalog? = parsed[version]

    override fun rawJson(version: String): String? = raw[version]

    companion object {
        private const val ROOT = "catalog"
        private val log = LoggerFactory.getLogger(ClasspathCatalogRepository::class.java)

        /** Strict on purpose: an unknown key means the catalog drifted from schema.json. */
        private val json = Json { ignoreUnknownKeys = false }

        fun load(classLoader: ClassLoader = ClasspathCatalogRepository::class.java.classLoader): ClasspathCatalogRepository {
            val index =
                classLoader
                    .resource("$ROOT/versions.txt")
                    .lines()
                    .filter { it.isNotBlank() }
                    .map { it.trim() }
            check(index.isNotEmpty()) { "No animation catalog versions are bundled with this build" }

            val raw = index.associateWith { classLoader.resource("$ROOT/versions/$it.json") }
            val parsed =
                raw.mapValues { (version, body) ->
                    val catalog = json.decodeFromString<Catalog>(body)
                    check(catalog.version == version) {
                        "Catalog file $version.json declares version '${catalog.version}'"
                    }
                    catalog
                }

            val current = classLoader.resource("$ROOT/current").trim()
            check(current in parsed) { "current catalog version '$current' has no versions/$current.json" }

            val ordered = index.sortedWith(SEMVER_ORDER)
            log.info("Loaded animation catalog versions {} (current {})", ordered, current)
            return ClasspathCatalogRepository(current, ordered, parsed, raw)
        }

        private val SEMVER_ORDER =
            compareBy<String> { it.semverPart(0) }
                .thenBy { it.semverPart(1) }
                .thenBy { it.semverPart(2) }

        private fun String.semverPart(index: Int): Int = split('.').getOrNull(index)?.toIntOrNull() ?: 0

        private fun ClassLoader.resource(path: String): String =
            getResourceAsStream(path)?.bufferedReader()?.use { it.readText() }
                ?: throw IllegalStateException("Missing catalog resource '$path'")
    }
}
