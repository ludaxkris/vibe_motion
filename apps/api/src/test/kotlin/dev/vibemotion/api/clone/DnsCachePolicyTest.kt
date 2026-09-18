package dev.vibemotion.api.clone

import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.shouldBe
import java.security.Security

class DnsCachePolicyTest :
    FunSpec({

        test("pins both DNS cache TTLs, and is safe to apply more than once") {
            DnsCachePolicy.apply()

            Security.getProperty("networkaddress.cache.ttl") shouldBe DnsCachePolicy.POSITIVE_TTL_SECONDS
            Security.getProperty("networkaddress.cache.negative.ttl") shouldBe DnsCachePolicy.NEGATIVE_TTL_SECONDS

            DnsCachePolicy.apply()

            Security.getProperty("networkaddress.cache.ttl") shouldBe DnsCachePolicy.POSITIVE_TTL_SECONDS
            Security.getProperty("networkaddress.cache.negative.ttl") shouldBe DnsCachePolicy.NEGATIVE_TTL_SECONDS
        }

        test("the positive TTL outlives the gap between the guard's lookup and the client's connect") {
            // The guard vets, then the JDK client connects milliseconds later. They only agree on
            // what the host resolves to while the cache entry they share is still alive.
            DnsCachePolicy.POSITIVE_TTL_SECONDS.toInt() shouldBe 60
            DnsCachePolicy.NEGATIVE_TTL_SECONDS.toInt() shouldBe 10
        }
    })
