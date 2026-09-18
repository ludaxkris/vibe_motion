# Vibe Motion API — multi-stage build.
#
# Build context is the REPO ROOT (see render.yaml: dockerfilePath ./apps/api/Dockerfile,
# dockerContext .) because the service bundles packages/animation-catalog into its jar.
#
#   docker build -f apps/api/Dockerfile -t vibe-motion-api:dev .

# ---------------------------------------------------------------------------
# Stage 1 — build with the Gradle wrapper on a JDK 21 toolchain
# ---------------------------------------------------------------------------
FROM eclipse-temurin:21-jdk AS build

WORKDIR /workspace/apps/api

# Wrapper and build scripts first: these change far less often than the sources,
# so the Gradle distribution and the dependency cache stay in the layer cache.
COPY apps/api/gradlew ./gradlew
COPY apps/api/gradle ./gradle
COPY apps/api/settings.gradle.kts apps/api/build.gradle.kts apps/api/gradle.properties ./
RUN ./gradlew --no-daemon --version > /dev/null

COPY packages/animation-catalog /workspace/packages/animation-catalog
COPY apps/api/.editorconfig ./.editorconfig
COPY apps/api/src ./src

# installDist produces build/install/vibe-motion-api/{bin,lib}. Tests are not run here:
# they need a Docker daemon for Testcontainers and run in CI instead.
RUN ./gradlew --no-daemon --console=plain installDist

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
FROM eclipse-temurin:21-jre

RUN groupadd --system --gid 10001 vibe \
    && useradd --system --uid 10001 --gid vibe --home-dir /app --shell /usr/sbin/nologin vibe

WORKDIR /app
COPY --from=build --chown=vibe:vibe /workspace/apps/api/build/install/vibe-motion-api /app

USER vibe:vibe
ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/app/bin/vibe-motion-api"]
