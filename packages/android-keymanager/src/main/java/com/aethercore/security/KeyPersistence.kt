package com.aethercore.security

import android.content.Context

interface KeyAliasStore {
    fun readAlias(): String?
    fun readSecurityLevel(): SecurityLevel?
    fun writeReference(alias: String, securityLevel: SecurityLevel)
}

class SharedPreferencesKeyAliasStore(
    context: Context,
    private val prefName: String = "aethercore_key_manager"
) : KeyAliasStore {
    private val prefs = context.getSharedPreferences(prefName, Context.MODE_PRIVATE)

    override fun readAlias(): String? = prefs.getString(KEY_ALIAS, null)

    override fun readSecurityLevel(): SecurityLevel? {
        val raw = prefs.getString(KEY_LEVEL, null) ?: return null
        return SecurityLevel.entries.firstOrNull { it.name == raw }
    }

    override fun writeReference(alias: String, securityLevel: SecurityLevel) {
        prefs.edit()
            .putString(KEY_ALIAS, alias)
            .putString(KEY_LEVEL, securityLevel.name)
            .apply()
    }

    private companion object {
        const val KEY_ALIAS = "enrollment_key_alias"
        const val KEY_LEVEL = "enrollment_key_security_level"
    }
}
