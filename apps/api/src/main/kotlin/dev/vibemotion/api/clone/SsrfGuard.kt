package dev.vibemotion.api.clone

import java.net.InetAddress
import java.net.URI
import java.net.URISyntaxException
import java.net.UnknownHostException
import java.util.Locale

/**
 * Resolves a host name to every address it maps to.
 *
 * Injected so the guard can be tested exhaustively without DNS, and so a future deployment can
 * swap in a resolver that pins results for the lifetime of a request.
 */
fun interface HostResolver {
    @Throws(UnknownHostException::class)
    fun resolve(host: String): List<InetAddress>

    companion object {
        /** The system stub resolver. */
        val SYSTEM: HostResolver = HostResolver { host -> InetAddress.getAllByName(host).toList() }
    }
}

/** A URL that passed every SSRF rule, with the addresses it resolved to. */
data class VettedUrl(
    val uri: URI,
    /** Lower-cased, trailing-dot-stripped host. An IPv6 literal keeps its brackets. */
    val host: String,
    val addresses: List<InetAddress>,
)

/**
 * Decides whether a URL may be fetched at all.
 *
 * Applied before *every* network hop — the initial URL, each redirect, and each stylesheet — so a
 * hostile page cannot walk the fetcher onto the loopback interface or a cloud metadata endpoint by
 * redirecting it there.
 *
 * Failure mapping: a malformed or non-http(s) URL is [CloneException.InvalidUrl]; a URL the rules
 * refuse is [CloneException.Blocked]; a host that does not resolve is [CloneException.Unreachable].
 * Messages name the rule that fired and never the address behind it, so the guard cannot be turned
 * into an internal host scanner.
 *
 * Known gap — DNS rebinding (DT-039): the JDK HTTP client re-resolves the host when it opens the
 * socket, so there is a TOCTOU window between this check and the connect. In practice both lookups
 * are served from the same process-wide `InetAddress` cache, whose TTL [DnsCachePolicy] pins for
 * exactly this reason — but that narrows the window to the instant an entry expires between the
 * two, it does not close it. Closing it needs a connect path that pins the vetted [InetAddress]
 * (or an egress proxy that applies the same rules), which is what DT-039 tracks.
 *
 * Known gap — ports (DT-040): any port on a public host is fetchable. The rules here are about
 * *where* a request may go, not which service answers there.
 */
class SsrfGuard internal constructor(
    private val resolver: HostResolver,
    /**
     * Skips the loopback rule and nothing else, so tests can fetch from a local fixture server.
     * Reachable from Kotlin in this module only: there is deliberately no environment variable or
     * config field anywhere that can turn it on in a deployment.
     */
    private val allowLoopbackForTests: Boolean,
) {
    constructor(resolver: HostResolver = HostResolver.SYSTEM) : this(resolver, false)

    /** @throws CloneException when [url] must not be fetched. */
    fun vet(url: String): VettedUrl {
        val uri = parse(url)
        val host = hostOf(uri)
        checkName(host)
        val addresses = addressesFor(host)
        addresses.forEach { address ->
            ruleFor(address)?.let { rule ->
                throw CloneException.Blocked("refusing '$host': it points at ${rule.description}")
            }
        }
        return VettedUrl(uri, host, addresses)
    }

    private fun parse(url: String): URI {
        val trimmed = url.trim()
        if (trimmed.isEmpty()) throw CloneException.InvalidUrl("a URL is required")
        val uri =
            try {
                URI(trimmed)
            } catch (e: URISyntaxException) {
                throw CloneException.InvalidUrl("'$trimmed' is not a valid URL: ${e.reason}")
            }
        val scheme = uri.scheme?.lowercase(Locale.ROOT)
        if (scheme != "http" && scheme != "https") {
            throw CloneException.InvalidUrl("only http and https URLs can be cloned")
        }
        val authority = uri.rawAuthority
        if (authority.isNullOrBlank()) throw CloneException.InvalidUrl("the URL must include a host")
        if (authority.contains('@')) {
            throw CloneException.Blocked("refusing a URL that carries credentials in its authority")
        }
        return uri
    }

    /**
     * [URI.getHost] is null for authorities it considers malformed — an all-numeric host, an
     * underscore in a label — which are exactly the shapes an attacker reaches for, so the raw
     * authority is the fallback rather than an acceptance.
     */
    private fun hostOf(uri: URI): String {
        val raw = uri.host ?: hostFromAuthority(uri.rawAuthority.orEmpty())
        val host = raw.trim().removeSuffix(".").lowercase(Locale.ROOT)
        if (host.isEmpty()) throw CloneException.InvalidUrl("the URL must include a host")
        return host
    }

    private fun hostFromAuthority(authority: String): String {
        val afterUserInfo = authority.substringAfterLast('@')
        if (afterUserInfo.startsWith("[")) return afterUserInfo.substringBefore(']') + "]"
        return afterUserInfo.substringBefore(':')
    }

    private fun checkName(host: String) {
        if (host.startsWith("[")) return
        val isLocalName = host == "localhost" || LOCAL_SUFFIXES.any { host.endsWith(it) }
        if (isLocalName) {
            throw CloneException.Blocked("refusing '$host': it is a local host name")
        }
    }

    private fun addressesFor(host: String): List<InetAddress> {
        literalAddress(host)?.let { return listOf(it) }
        val resolved =
            try {
                resolver.resolve(host)
            } catch (e: UnknownHostException) {
                throw CloneException.Unreachable("could not resolve the host '$host'", e)
            }
        if (resolved.isEmpty()) throw CloneException.Unreachable("could not resolve the host '$host'")
        return resolved
    }

    /**
     * Turns a host that is already an address into one, in every notation `InetAddress` accepts:
     * dotted quad, the `inet_aton` short forms (`127.1`), decimal, octal and hex integers
     * (`2130706433`, `0x7f000001`, `0177.0.0.1`), and bracketed IPv6. Anything else is a name, and
     * goes to the resolver.
     */
    private fun literalAddress(host: String): InetAddress? {
        if (host.startsWith("[") && host.endsWith("]")) {
            val text = host.substring(1, host.length - 1).substringBefore('%')
            return try {
                InetAddress.getByName("[$text]")
            } catch (e: UnknownHostException) {
                throw CloneException.InvalidUrl("'$host' is not a valid IPv6 address")
            }
        }
        return parseIpv4Literal(host)
    }

    private fun ruleFor(address: InetAddress): AddressRule? {
        val bytes = address.address
        if (bytes.size != ADDRESS_BYTES_V6) return ipv4Rule(bytes)
        ipv6Rule(bytes)?.let { return it }
        val embedded = embeddedIpv4(bytes) ?: return null
        return ipv4Rule(embedded)
    }

    private fun ipv6Rule(bytes: ByteArray): AddressRule? {
        val first = bytes.octet(0)
        val second = bytes.octet(1)
        return when {
            isLoopbackV6(bytes) -> AddressRule.LOOPBACK.unlessLoopbackIsAllowed()
            bytes.all { it.toInt() == 0 } -> AddressRule.UNSPECIFIED
            first == 0xFF -> AddressRule.MULTICAST
            first == 0xFE && (second and 0xC0) == 0x80 -> AddressRule.LINK_LOCAL
            first == 0xFE && (second and 0xC0) == 0xC0 -> AddressRule.PRIVATE
            (first and 0xFE) == 0xFC -> AddressRule.UNIQUE_LOCAL
            isDocumentationV6(bytes) -> AddressRule.RESERVED
            else -> null
        }
    }

    private fun ipv4Rule(bytes: ByteArray): AddressRule? {
        if (bytes.size != ADDRESS_BYTES_V4) return null
        val a = bytes.octet(0)
        val b = bytes.octet(1)
        val c = bytes.octet(2)
        val d = bytes.octet(3)
        return when {
            a == 127 -> AddressRule.LOOPBACK.unlessLoopbackIsAllowed()
            a == 0 -> AddressRule.UNSPECIFIED
            a == 169 && b == 254 -> AddressRule.LINK_LOCAL
            a == 10 -> AddressRule.PRIVATE
            a == 172 && b in 16..31 -> AddressRule.PRIVATE
            a == 192 && b == 168 -> AddressRule.PRIVATE
            a == 100 && b in 64..127 -> AddressRule.CARRIER_GRADE_NAT
            a in 224..239 -> AddressRule.MULTICAST
            a == 255 && b == 255 && c == 255 && d == 255 -> AddressRule.BROADCAST
            a >= 240 -> AddressRule.RESERVED
            a == 192 && b == 0 && (c == 0 || c == 2) -> AddressRule.RESERVED
            a == 198 && b in 18..19 -> AddressRule.RESERVED
            a == 198 && b == 51 && c == 100 -> AddressRule.RESERVED
            a == 203 && b == 0 && c == 113 -> AddressRule.RESERVED
            else -> null
        }
    }

    private fun AddressRule.unlessLoopbackIsAllowed(): AddressRule? = if (allowLoopbackForTests) null else this

    companion object {
        private const val ADDRESS_BYTES_V4 = 4
        private const val ADDRESS_BYTES_V6 = 16
        private const val RADIX_OCTAL = 8
        private const val RADIX_DECIMAL = 10
        private const val RADIX_HEX = 16

        private val LOCAL_SUFFIXES = listOf(".localhost", ".internal", ".local")
        private val LAST_PART_MAX = listOf(0xFFFFFFFFL, 0xFFFFFFL, 0xFFFFL, 0xFFL)

        private fun ByteArray.octet(index: Int): Int = this[index].toInt() and 0xFF

        private fun isLoopbackV6(bytes: ByteArray): Boolean =
            bytes.take(ADDRESS_BYTES_V6 - 1).all { it.toInt() == 0 } && bytes.octet(15) == 1

        /** 2001:db8::/32, the IPv6 documentation prefix. */
        private fun isDocumentationV6(bytes: ByteArray): Boolean =
            bytes.octet(0) == 0x20 && bytes.octet(1) == 0x01 && bytes.octet(2) == 0x0D && bytes.octet(3) == 0xB8

        /**
         * The four IPv4 bytes an IPv6 address carries inside it, or null when it carries none.
         *
         * Five wrappers, all of which end up delivering a packet to an IPv4 endpoint, so the IPv4
         * rules have to apply to what they wrap:
         *  - IPv4-mapped `::ffff:a.b.c.d` and IPv4-compatible `::a.b.c.d`, in the last four bytes;
         *  - NAT64 `64:ff9b::a.b.c.d`, likewise;
         *  - 6to4 `2002::/16`, which carries the address verbatim in bytes 2-5;
         *  - Teredo `2001:0::/32`, whose *client* address is the last four bytes, ones-complemented.
         *
         * Teredo's other embedded IPv4 (the server, bytes 4-7) is deliberately not checked: it says
         * which relay carries the traffic, not where the traffic ends up.
         */
        private fun embeddedIpv4(bytes: ByteArray): ByteArray? {
            val leadingZeros = bytes.take(10).all { it.toInt() == 0 }
            val mapped = leadingZeros && bytes.octet(10) == 0xFF && bytes.octet(11) == 0xFF
            val compatible = leadingZeros && bytes.octet(10) == 0 && bytes.octet(11) == 0
            val nat64 =
                bytes.octet(0) == 0x00 && bytes.octet(1) == 0x64 &&
                    bytes.octet(2) == 0xFF && bytes.octet(3) == 0x9B &&
                    (4..11).all { bytes.octet(it) == 0 }
            val sixToFour = bytes.octet(0) == 0x20 && bytes.octet(1) == 0x02
            val teredo =
                bytes.octet(0) == 0x20 && bytes.octet(1) == 0x01 &&
                    bytes.octet(2) == 0x00 && bytes.octet(3) == 0x00
            return when {
                mapped || compatible || nat64 -> bytes.copyOfRange(12, ADDRESS_BYTES_V6)
                sixToFour -> bytes.copyOfRange(2, 6)
                teredo -> ByteArray(ADDRESS_BYTES_V4) { index -> (bytes.octet(12 + index) xor 0xFF).toByte() }
                else -> null
            }
        }

        /**
         * `inet_aton` semantics: one to four parts, each decimal, octal (`0…`) or hex (`0x…`),
         * with the last part absorbing every remaining byte.
         */
        private fun parseIpv4Literal(host: String): InetAddress? {
            val parts = host.split('.')
            if (parts.size !in 1..ADDRESS_BYTES_V4) return null
            val values = parts.map { parseNumber(it) ?: return null }
            if (values.last() > LAST_PART_MAX[parts.size - 1]) return null
            if (values.dropLast(1).any { it > 0xFF }) return null

            var packed = values.last()
            values.dropLast(1).forEachIndexed { index, part ->
                packed = packed or (part shl (8 * (3 - index)))
            }
            val bytes =
                byteArrayOf(
                    ((packed shr 24) and 0xFF).toByte(),
                    ((packed shr 16) and 0xFF).toByte(),
                    ((packed shr 8) and 0xFF).toByte(),
                    (packed and 0xFF).toByte(),
                )
            return InetAddress.getByAddress(host, bytes)
        }

        private fun parseNumber(text: String): Long? {
            val isHex = text.length > 2 && (text.startsWith("0x") || text.startsWith("0X"))
            val isOctal = !isHex && text.length > 1 && text[0] == '0'
            val digits =
                when {
                    isHex -> text.drop(2)
                    isOctal -> text.drop(1)
                    else -> text
                }
            if (digits.isEmpty()) return null
            val radix =
                when {
                    isHex -> RADIX_HEX
                    isOctal -> RADIX_OCTAL
                    else -> RADIX_DECIMAL
                }
            if (!digits.all { it.isDigitIn(radix) }) return null
            return digits.toLongOrNull(radix)
        }

        private fun Char.isDigitIn(radix: Int): Boolean = Character.digit(this, radix) >= 0
    }
}

/** The reason a resolved address is refused. Descriptions are safe to show a user. */
internal enum class AddressRule(
    val description: String,
) {
    LOOPBACK("a loopback address"),
    UNSPECIFIED("an unspecified address"),
    LINK_LOCAL("a link-local address"),
    PRIVATE("a private network address"),
    CARRIER_GRADE_NAT("a carrier-grade NAT address"),
    MULTICAST("a multicast address"),
    BROADCAST("a broadcast address"),
    UNIQUE_LOCAL("a unique-local address"),
    RESERVED("a reserved address"),
}
