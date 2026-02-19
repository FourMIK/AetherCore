package com.aethercore.security

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import java.security.ProviderException

@RunWith(AndroidJUnit4::class)
class AndroidEnrollmentKeyManagerInstrumentedTest {

    @Test
    fun strongBoxAvailable_pathRequestsStrongBoxAndPersistsReferenceOnly() {
        val store = InMemoryAliasStore()
        val keyStore = FakeKeyStoreFacade(strongBoxRequestThrows = false)
        val manager = AndroidEnrollmentKeyManager(
            keyStore = keyStore,
            aliasStore = store,
            strongBoxSupport = AlwaysStrongBoxSupport(true),
            aliasFactory = { "sb-alias" }
        )

        val challenge = byteArrayOf(1, 2, 3)
        val payload = manager.buildEnrollmentProvePayload(challenge)

        assertEquals("sb-alias", payload.keyAlias)
        assertEquals(SecurityLevel.STRONGBOX.name, payload.keySecurityLevel)
        assertEquals(listOf(true), keyStore.generationRequests)
        assertEquals("sb-alias", store.readAlias())
        assertEquals(SecurityLevel.STRONGBOX, store.readSecurityLevel())
        assertArrayEquals(challenge, keyStore.lastChallenge)
    }

    @Test
    fun strongBoxFallback_pathUsesTeeWhenStrongBoxUnavailable() {
        val store = InMemoryAliasStore()
        val keyStore = FakeKeyStoreFacade(strongBoxRequestThrows = true)
        val manager = AndroidEnrollmentKeyManager(
            keyStore = keyStore,
            aliasStore = store,
            strongBoxSupport = AlwaysStrongBoxSupport(true),
            aliasFactory = { "tee-alias" }
        )

        val reference = manager.ensureEnrollmentKey(byteArrayOf(9, 9, 9))

        assertEquals(SecurityLevel.TRUSTED_ENVIRONMENT, reference.securityLevel)
        assertEquals(listOf(true, false), keyStore.generationRequests)
        assertEquals(SecurityLevel.TRUSTED_ENVIRONMENT, manager.securityLevel())
    }

    @Test
    fun keyPersistence_reusesAliasAcrossRestartOrUpdate() {
        val appContext = InstrumentationRegistry.getInstrumentation().targetContext
        assertNotNull(appContext)

        val sharedStore = InMemoryAliasStore()
        val keyStore = FakeKeyStoreFacade(strongBoxRequestThrows = false)

        val first = AndroidEnrollmentKeyManager(
            keyStore = keyStore,
            aliasStore = sharedStore,
            strongBoxSupport = AlwaysStrongBoxSupport(false),
            aliasFactory = { "persistent-alias" }
        )

        val second = AndroidEnrollmentKeyManager(
            keyStore = keyStore,
            aliasStore = sharedStore,
            strongBoxSupport = AlwaysStrongBoxSupport(true),
            aliasFactory = { "new-alias-should-not-be-used" }
        )

        val original = first.ensureEnrollmentKey(byteArrayOf(4))
        val reused = second.ensureEnrollmentKey(byteArrayOf(5))

        assertEquals("persistent-alias", original.alias)
        assertEquals("persistent-alias", reused.alias)
        assertEquals(1, keyStore.generationRequests.size)
    }
}

private class AlwaysStrongBoxSupport(private val supported: Boolean) : StrongBoxSupport {
    override fun isStrongBoxSupported(): Boolean = supported
}

private class InMemoryAliasStore : KeyAliasStore {
    private var alias: String? = null
    private var level: SecurityLevel? = null

    override fun readAlias(): String? = alias

    override fun readSecurityLevel(): SecurityLevel? = level

    override fun writeReference(alias: String, securityLevel: SecurityLevel) {
        this.alias = alias
        this.level = securityLevel
    }
}

private class FakeKeyStoreFacade(
    private val strongBoxRequestThrows: Boolean
) : KeyStoreFacade {
    val generationRequests = mutableListOf<Boolean>()
    var lastChallenge: ByteArray = ByteArray(0)
    private val keys = mutableMapOf<String, KeyReference>()

    override fun loadKeyReference(alias: String): KeyReference? = keys[alias]

    override fun generateKey(alias: String, useStrongBox: Boolean, challenge: ByteArray): KeyReference {
        generationRequests.add(useStrongBox)
        lastChallenge = challenge

        if (useStrongBox && strongBoxRequestThrows) {
            throw ProviderException("StrongBox unavailable")
        }

        val reference = KeyReference(
            alias = alias,
            securityLevel = if (useStrongBox) SecurityLevel.STRONGBOX else SecurityLevel.TRUSTED_ENVIRONMENT,
            attestationCertificateChainDer = listOf("cert-$alias".toByteArray())
        )
        keys[alias] = reference
        return reference
    }
}
