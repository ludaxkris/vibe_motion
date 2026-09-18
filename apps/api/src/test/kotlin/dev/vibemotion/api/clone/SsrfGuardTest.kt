package dev.vibemotion.api.clone

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import java.net.Inet6Address
import java.net.InetAddress
import java.net.UnknownHostException

/**
 * The guard is the only thing standing between "clone any URL a user types" and the cloud
 * metadata endpoint, so every range is asserted explicitly rather than trusting the JDK's
 * `isSiteLocalAddress` family.
 */
class SsrfGuardTest :
    FunSpec({

        /** A resolver that maps every host to [addresses], so no test ever touches DNS. */
        fun resolving(vararg addresses: String): HostResolver = HostResolver { addresses.map { InetAddress.getByName(it) } }

        val exploding =
            HostResolver { host ->
                throw AssertionError("the guard must not resolve '$host': it is an IP literal")
            }

        test("rejects every reserved IPv4 range, naming the rule") {
            val blocked =
                mapOf(
                    "127.0.0.1" to "loopback",
                    "127.255.255.254" to "loopback",
                    "0.0.0.0" to "unspecified",
                    "0.1.2.3" to "unspecified",
                    "169.254.169.254" to "link-local",
                    "169.254.0.1" to "link-local",
                    "10.0.0.1" to "private",
                    "10.255.255.255" to "private",
                    "172.16.0.1" to "private",
                    "172.31.255.255" to "private",
                    "192.168.1.1" to "private",
                    "100.64.0.1" to "carrier-grade NAT",
                    "100.127.255.255" to "carrier-grade NAT",
                    "224.0.0.1" to "multicast",
                    "239.255.255.250" to "multicast",
                    "255.255.255.255" to "broadcast",
                    "192.0.2.5" to "reserved",
                    "198.18.0.1" to "reserved",
                    "198.19.255.254" to "reserved",
                    "198.51.100.7" to "reserved",
                    "203.0.113.9" to "reserved",
                    "240.0.0.1" to "reserved",
                )

            blocked.forEach { (address, rule) ->
                withClue("$address must be blocked as $rule") {
                    val guard = SsrfGuard(resolving(address))
                    val error = shouldThrow<CloneException.Blocked> { guard.vet("https://probe.example.com/page") }
                    error.code shouldBe "url_blocked"
                    error.message.orEmpty() shouldContain rule
                    // The rule is named; the address behind it never is.
                    error.message.orEmpty() shouldNotContain address
                }
            }
        }

        test("rejects every reserved IPv6 range") {
            val blocked =
                mapOf(
                    "::1" to "loopback",
                    "::" to "unspecified",
                    "fe80::1" to "link-local",
                    "febf:ffff::1" to "link-local",
                    "fc00::1" to "unique-local",
                    "fd12:3456::1" to "unique-local",
                    "fec0::1" to "private",
                    "ff02::1" to "multicast",
                    "2001:db8::1" to "reserved",
                )

            blocked.forEach { (address, rule) ->
                withClue("$address must be blocked as $rule") {
                    val guard = SsrfGuard(resolving(address))
                    val error = shouldThrow<CloneException.Blocked> { guard.vet("https://probe.example.com/page") }
                    error.message.orEmpty() shouldContain rule
                }
            }
        }

        test("unwraps IPv4-mapped and IPv4-compatible IPv6 addresses before checking them") {
            // Constructed through Inet6Address so the JDK does not silently hand back an
            // Inet4Address: the point is that a v6 wrapper around a private v4 address is caught.
            val mappedLoopback = Inet6Address.getByAddress(null, v6Bytes(0xFF, 0xFF, 127, 0, 0, 1), 0)
            val compatiblePrivate = Inet6Address.getByAddress(null, v6Bytes(0x00, 0x00, 10, 0, 0, 1), 0)
            val nat64Metadata = InetAddress.getByName("64:ff9b::a9fe:a9fe")

            listOf(
                mappedLoopback to "loopback",
                compatiblePrivate to "private",
                nat64Metadata to "link-local",
            ).forEach { (address, rule) ->
                withClue("${address.hostAddress} must be blocked as $rule") {
                    val guard = SsrfGuard(HostResolver { listOf(address) })
                    val error = shouldThrow<CloneException.Blocked> { guard.vet("https://probe.example.com/") }
                    error.message.orEmpty() shouldContain rule
                }
            }
        }

        test("allows ordinary public addresses and returns what they resolved to") {
            listOf(
                "93.184.216.34",
                "8.8.8.8",
                "1.1.1.1",
                "151.101.1.140",
                "2606:2800:220:1:248:1893:25c8:1946",
                "2001:4860:4860::8888",
            ).forEach { address ->
                withClue("$address must be allowed") {
                    val guard = SsrfGuard(resolving(address))
                    val vetted = guard.vet("https://example.com/index.html")
                    vetted.host shouldBe "example.com"
                    vetted.addresses shouldHaveSize 1
                    vetted.addresses.single() shouldBe InetAddress.getByName(address)
                }
            }
        }

        test("blocks a host as soon as any one of its addresses is reserved") {
            val guard = SsrfGuard(resolving("93.184.216.34", "127.0.0.1"))
            shouldThrow<CloneException.Blocked> { guard.vet("https://split-horizon.example.com/") }
        }

        test("blocks numeric-obfuscated hosts without ever consulting DNS") {
            listOf(
                "http://2130706433/",
                "http://0x7f000001/",
                "http://0177.0.0.1/",
                "http://0x7f.1/",
                "http://127.1/",
                "http://127.0.1/",
                "http://[::1]/",
                "http://[::ffff:127.0.0.1]/",
                "http://[0:0:0:0:0:0:0:1]/",
            ).forEach { url ->
                withClue(url) {
                    val guard = SsrfGuard(exploding)
                    shouldThrow<CloneException.Blocked> { guard.vet(url) }
                }
            }
        }

        test("blocks local host names without resolving them") {
            listOf(
                "http://localhost/",
                "http://localhost./",
                "http://LOCALHOST:8080/",
                "http://api.localhost/",
                "http://metadata.internal/",
                "http://printer.local/",
            ).forEach { url ->
                withClue(url) {
                    val guard = SsrfGuard(HostResolver { throw AssertionError("must not resolve") })
                    val error = shouldThrow<CloneException.Blocked> { guard.vet(url) }
                    error.message.orEmpty() shouldContain "local host name"
                }
            }
        }

        test("rejects credentials in the authority without echoing them") {
            val guard = SsrfGuard(resolving("93.184.216.34"))
            val error = shouldThrow<CloneException.Blocked> { guard.vet("https://user:hunter2@example.com/") }
            error.message.orEmpty() shouldContain "credentials"
            error.message.orEmpty() shouldNotContain "hunter2"
        }

        test("rejects anything that is not an absolute http(s) URL") {
            val guard = SsrfGuard(resolving("93.184.216.34"))
            listOf(
                "",
                "   ",
                "example.com/page",
                "//example.com/page",
                "file:///etc/passwd",
                "ftp://example.com/x",
                "gopher://example.com:70/",
                "javascript:alert(1)",
                "http://",
                "ht tp://example.com",
            ).forEach { url ->
                withClue("'$url'") {
                    val error = shouldThrow<CloneException.InvalidUrl> { guard.vet(url) }
                    error.code shouldBe "invalid_url"
                }
            }
        }

        test("maps a DNS failure to Unreachable, not Blocked") {
            val guard = SsrfGuard(HostResolver { throw UnknownHostException(it) })
            val error = shouldThrow<CloneException.Unreachable> { guard.vet("https://nope.example.com/") }
            error.code shouldBe "url_unreachable"
            error.message.orEmpty() shouldContain "resolve"
        }

        test("maps an empty resolution to Unreachable") {
            val guard = SsrfGuard(HostResolver { emptyList() })
            shouldThrow<CloneException.Unreachable> { guard.vet("https://nope.example.com/") }
        }

        test("the test-only loopback policy relaxes loopback and nothing else") {
            val guard = SsrfGuard(HostResolver.SYSTEM, allowLoopbackForTests = true)

            guard.vet("http://127.0.0.1:9999/page").host shouldBe "127.0.0.1"

            shouldThrow<CloneException.Blocked> { guard.vet("http://localhost:9999/page") }
            shouldThrow<CloneException.Blocked> { guard.vet("http://10.0.0.1/page") }
            shouldThrow<CloneException.Blocked> { guard.vet("http://169.254.169.254/latest/meta-data") }
        }

        test("normalises the host before checking it") {
            val guard = SsrfGuard(resolving("93.184.216.34"))
            guard.vet("https://EXAMPLE.com./page").host shouldBe "example.com"
        }
    })

/** A 16-byte IPv6 address made of ten zero bytes, two prefix bytes and four IPv4 bytes. */
private fun v6Bytes(
    prefixHigh: Int,
    prefixLow: Int,
    a: Int,
    b: Int,
    c: Int,
    d: Int,
): ByteArray {
    val bytes = ByteArray(16)
    bytes[10] = prefixHigh.toByte()
    bytes[11] = prefixLow.toByte()
    bytes[12] = a.toByte()
    bytes[13] = b.toByte()
    bytes[14] = c.toByte()
    bytes[15] = d.toByte()
    return bytes
}
