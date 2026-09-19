import org.jlleitschuh.gradle.ktlint.reporter.ReporterType

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ktlint)
    application
}

group = "dev.vibemotion"
version = "0.1.0"

kotlin {
    jvmToolchain(21)
}

application {
    mainClass.set("dev.vibemotion.api.ApplicationKt")
    applicationName = "vibe-motion-api"
}

dependencies {
    implementation(libs.ktor.server.core)
    implementation(libs.ktor.server.netty)
    implementation(libs.ktor.server.content.negotiation)
    implementation(libs.ktor.serialization.kotlinx.json)
    implementation(libs.ktor.server.cors)
    implementation(libs.ktor.server.call.logging)
    implementation(libs.ktor.server.status.pages)
    implementation(libs.ktor.server.default.headers)

    implementation(libs.kotlinx.serialization.json)

    implementation(libs.exposed.core)
    implementation(libs.exposed.jdbc)
    implementation(libs.exposed.java.time)
    implementation(libs.exposed.json)

    implementation(libs.flyway.core)
    runtimeOnly(libs.flyway.database.postgresql)
    implementation(libs.hikaricp)
    runtimeOnly(libs.postgresql)
    implementation(libs.jsoup)
    implementation(libs.logback.classic)

    testImplementation(libs.kotest.runner.junit5)
    testImplementation(libs.kotest.assertions.core)
    testImplementation(libs.kotest.property)
    testImplementation(libs.ktor.server.test.host)
    testImplementation(libs.testcontainers.postgresql)
    testImplementation(libs.postgresql)
}

// ---------------------------------------------------------------------------
// Animation catalog: packages/animation-catalog is the single source of truth.
// Its published versions and the `current` pointer are copied into the jar under
// catalog/ so the API serves exactly the files the web app and the exporter use.
// `versions.txt` is an index, because a directory inside a jar cannot be listed.
// ---------------------------------------------------------------------------
val catalogSource: Directory = layout.projectDirectory.dir("../../packages/animation-catalog")

val catalogResources =
    tasks.register<Sync>("catalogResources") {
        description = "Copies packages/animation-catalog into the API resources."
        group = "build"
        into(layout.buildDirectory.dir("generated/catalog"))
        from(catalogSource.dir("versions")) {
            include("*.json")
            into("versions")
        }
        from(catalogSource.file("current"))
        doLast {
            val out = destinationDir
            val versions =
                File(out, "versions")
                    .listFiles { file -> file.isFile && file.name.endsWith(".json") }
                    .orEmpty()
                    .map { it.name.removeSuffix(".json") }
                    .sorted()
            check(versions.isNotEmpty()) { "No catalog versions found in $catalogSource" }
            File(out, "versions.txt").writeText(versions.joinToString(separator = "\n", postfix = "\n"))
        }
    }

// ---------------------------------------------------------------------------
// Preview bridge: packages/bridge/src/vm-bridge.js is the single source of truth
// for the script served at /bridge/vm-bridge.js and injected into every cloned
// page. It is copied into the jar the same way the catalog is, rather than kept
// as a second copy under src/main/resources, so the file the API serves, the
// file the web mock route serves and the file the package's own vitest and
// Playwright suites exercise are byte-identical. BridgeAssets parses
// BRIDGE_VERSION out of it; nothing here hand-syncs a version.
// ---------------------------------------------------------------------------
val bridgeSource: Directory = layout.projectDirectory.dir("../../packages/bridge")

val bridgeResources =
    tasks.register<Sync>("bridgeResources") {
        description = "Copies packages/bridge/src/vm-bridge.js into the API resources."
        group = "build"
        into(layout.buildDirectory.dir("generated/bridge"))
        from(bridgeSource.file("src/vm-bridge.js"))
        doLast {
            check(File(destinationDir, "vm-bridge.js").isFile) {
                "No bridge script found in $bridgeSource/src"
            }
        }
    }

tasks.processResources {
    from(catalogResources) {
        into("catalog")
    }
    from(bridgeResources) {
        into("bridge")
    }
}

// manifest.json is only read by CatalogManifestTest (a test-only cross-language parity check
// against packages/animation-catalog's TypeScript side); the running service never needs it, so
// it is copied into test resources only, not the production jar built by processResources above.
val catalogManifestDir = layout.buildDirectory.dir("generated/catalogManifest")

val catalogManifestResources =
    tasks.register<Sync>("catalogManifestResources") {
        description = "Copies packages/animation-catalog/manifest.json into API test resources only."
        group = "build"
        into(catalogManifestDir.map { it.dir("catalog") })
        from(catalogSource.file("manifest.json"))
    }

sourceSets {
    test {
        resources.srcDir(files(catalogManifestDir).builtBy(catalogManifestResources))
    }
}

ktlint {
    version.set(libs.versions.ktlint.get())
    reporters {
        reporter(ReporterType.PLAIN)
    }
    filter {
        exclude { it.file.path.contains("${File.separator}build${File.separator}") }
    }
}

tasks.test {
    useJUnitPlatform()
    testLogging {
        events("passed", "skipped", "failed")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}
