package dev.vibemotion.api.catalog

import io.kotest.assertions.withClue
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.collections.shouldBeSorted
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.string.shouldNotBeBlank
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

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
    })
