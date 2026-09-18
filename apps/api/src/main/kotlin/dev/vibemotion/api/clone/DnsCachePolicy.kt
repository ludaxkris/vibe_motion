package dev.vibemotion.api.clone

import java.security.Security

/**
 * Pins the JVM's DNS cache TTLs, so that [SsrfGuard] and the HTTP client see the same answer.
 *
 * The guard resolves a host with `InetAddress.getAllByName` and the JDK `HttpClient` resolves it
 * again, milliseconds later, when it opens the socket. Both go through the same process-wide
 * `InetAddress` cache, so in practice the second lookup is served from the entry the first one
 * created and an attacker's DNS server is never consulted twice. That property is the only thing
 * narrowing the rebinding window — and by default it rests on an *inherited* TTL that the security
 * manager, the deployment or a JDK release could change underneath us. Pinning it makes it a
 * decision.
 *
 * This narrows DT-039 (DNS rebinding TOCTOU between vet and connect); it does not close it. The
 * window is still open for the instant a cache entry expires between the two lookups. The real fix
 * is a fetch client with a DNS hook that connects to exactly the addresses in
 * [VettedUrl.addresses], which is what that field is already carrying.
 *
 * Idempotent: calling it twice sets the same two properties to the same two values.
 */
object DnsCachePolicy {
    /**
     * Long enough that a vet and the connect right after it share one answer; short enough that a
     * legitimate DNS change is picked up within a minute.
     */
    const val POSITIVE_TTL_SECONDS: String = "60"

    /** A failed lookup is worth remembering briefly, so a dead host cannot be a retry amplifier. */
    const val NEGATIVE_TTL_SECONDS: String = "10"

    private const val POSITIVE_TTL_PROPERTY = "networkaddress.cache.ttl"
    private const val NEGATIVE_TTL_PROPERTY = "networkaddress.cache.negative.ttl"

    fun apply() {
        Security.setProperty(POSITIVE_TTL_PROPERTY, POSITIVE_TTL_SECONDS)
        Security.setProperty(NEGATIVE_TTL_PROPERTY, NEGATIVE_TTL_SECONDS)
    }
}
