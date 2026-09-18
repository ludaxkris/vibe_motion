plugins {
    // Lets Gradle download a JDK 21 toolchain when the machine does not have one.
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "vibe-motion-api"

dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}
