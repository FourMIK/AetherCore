package com.aethercore.security

enum class SecurityLevel {
    STRONGBOX,
    TRUSTED_ENVIRONMENT
}

enum class SecurityProvenance {
    STRONGBOX,
    TEE,
    UNKNOWN_SOFTWARE
}

fun SecurityLevel.toSecurityProvenance(): SecurityProvenance = when (this) {
    SecurityLevel.STRONGBOX -> SecurityProvenance.STRONGBOX
    SecurityLevel.TRUSTED_ENVIRONMENT -> SecurityProvenance.TEE
}
