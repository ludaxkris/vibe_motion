package dev.vibemotion.api.catalog

private val SEMVER_RE = Regex("""^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$""")

/**
 * Keyframes name used in the runtime and in exports. Named by the full (animationId,
 * catalogVersion) pair — which is already the immutable identity of a keyframes template — so
 * assignments authored under different catalog versions never collide, by construction.
 *
 * Mirrors `packages/animation-catalog/scripts/gen-types.mjs`'s generated `keyframesName()`
 * (`src/index.ts`); [dev.vibemotion.api.catalog.CatalogManifestTest] proves the two agree for
 * every published `(version, animationId)` pair via the committed `manifest.json`.
 */
fun keyframesName(
    animationId: String,
    version: String,
): String {
    require(SEMVER_RE.matches(version)) { "keyframesName: \"$version\" is not a strict MAJOR.MINOR.PATCH semver" }
    return "vm-$animationId-v${version.replace('.', '-')}"
}
