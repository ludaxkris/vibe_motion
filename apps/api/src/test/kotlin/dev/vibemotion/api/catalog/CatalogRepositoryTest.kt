package dev.vibemotion.api.catalog

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.collections.shouldBeSorted
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotBeBlank
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.InputStream

class CatalogRepositoryTest :
    FunSpec({

        val repository = ClasspathCatalogRepository.load()

        test("bundles at least one published version and resolves current") {
            repository.versions().shouldNotBe(emptyList<String>())
            repository.versions() shouldContain repository.currentVersion
            repository.catalog(repository.currentVersion).shouldNotBeNull()
        }

        test("lists versions ascending by semver") {
            repository.versions().shouldBeSorted()
        }

        test("every published version parses and declares its own file name") {
            repository.versions().forEach { version ->
                val catalog = repository.catalog(version).shouldNotBeNull()
                catalog.version shouldBe version
                catalog.entries.isNotEmpty() shouldBe true
            }
        }

        test("every entry has a unique id and at least one trigger") {
            repository.versions().forEach { version ->
                val entries = repository.catalog(version).shouldNotBeNull().entries
                entries.map { it.id }.toSet().size shouldBe entries.size
                entries.forEach { entry ->
                    withClue("$version/${entry.id} must declare a trigger") {
                        entry.triggers.isNotEmpty() shouldBe true
                    }
                    entry.defaultTrigger?.let { default ->
                        withClue("$version/${entry.id} defaultTrigger must be one of its triggers") {
                            entry.triggers shouldContain default
                        }
                    }
                }
            }
        }

        test("every non-standard param declares a cssVar, as schema.json requires") {
            repository.versions().forEach { version ->
                repository.catalog(version).shouldNotBeNull().entries.forEach { entry ->
                    entry.params.filterNot { it.isStandard }.forEach { param ->
                        withClue("$version/${entry.id}/${param.key} needs a cssVar") {
                            param.cssVar.shouldNotBeNull().startsWith("--vm-") shouldBe true
                        }
                    }
                }
            }
        }

        test("serves the catalog file verbatim") {
            val raw = repository.rawJson(repository.currentVersion).shouldNotBeNull()
            raw.shouldNotBeBlank()
            Json
                .parseToJsonElement(raw)
                .jsonObject["version"]
                ?.jsonPrimitive
                ?.content shouldBe repository.currentVersion
        }

        test("returns null for an unpublished version") {
            repository.catalog("9.9.9") shouldBe null
            repository.rawJson("9.9.9") shouldBe null
        }

        test("loads a catalog carrying fields this build does not know about") {
            // A MINOR catalog release may add optional fields (CLAUDE.md). The loader runs in
            // main(), so an API build that predates such a release must still boot, and must
            // still serve the file verbatim so newer clients see the new fields.
            val loader =
                classLoaderServing(
                    """
                    {
                      "version": "1.0.0",
                      "generatedAt": "2026-01-01T00:00:00Z",
                      "entries": [
                        {
                          "id": "vm-fade-in",
                          "name": "Fade In",
                          "category": "entrance",
                          "description": "Fades the element in.",
                          "keyframes": "@keyframes vm-fade-in { from { opacity: 0 } to { opacity: 1 } }",
                          "params": [],
                          "triggers": ["load"],
                          "reducedMotionFallback": "none"
                        }
                      ]
                    }
                    """.trimIndent(),
                )

            val loaded = ClasspathCatalogRepository.load(loader)

            loaded.currentVersion shouldBe "1.0.0"
            val entries = loaded.catalog("1.0.0").shouldNotBeNull().entries
            entries.single().id shouldBe "vm-fade-in"
            loaded.rawJson("1.0.0").shouldNotBeNull() shouldContain "reducedMotionFallback"
        }

        test("still refuses a catalog that uses an enum value this build cannot honour") {
            // Tolerating unknown *keys* must not become tolerating unknown *values*: a category
            // or trigger the service does not understand is a MAJOR change, not a MINOR one.
            val loader =
                classLoaderServing(
                    """
                    {
                      "version": "1.0.0",
                      "entries": [
                        {
                          "id": "vm-teleport",
                          "name": "Teleport",
                          "category": "teleportation",
                          "description": "Not a category this build knows.",
                          "keyframes": "@keyframes vm-teleport { from { opacity: 0 } to { opacity: 1 } }",
                          "params": [],
                          "triggers": ["load"]
                        }
                      ]
                    }
                    """.trimIndent(),
                )

            shouldThrow<SerializationException> { ClasspathCatalogRepository.load(loader) }
        }
    })

/**
 * Serves the three catalog resources from memory, so a synthetic catalog file can be fed to
 * [ClasspathCatalogRepository.load] without disturbing the ones bundled in the jar.
 */
private fun classLoaderServing(catalogJson: String): ClassLoader =
    object : ClassLoader(null) {
        private val files =
            mapOf(
                "catalog/versions.txt" to "1.0.0\n",
                "catalog/current" to "1.0.0\n",
                "catalog/versions/1.0.0.json" to catalogJson,
            )

        override fun getResourceAsStream(name: String): InputStream? = files[name]?.byteInputStream()
    }
