package com.kubuno.android.data

import android.content.Context
import java.util.UUID

/**
 * Small non-secret preferences (server URL, device key, cached profile).
 * Plain SharedPreferences on purpose: everything here is either public or a
 * random identifier; tokens live in [com.kubuno.android.secure.FileTokenStore].
 */
class AppPrefs(context: Context) {
    private val prefs = context.getSharedPreferences("kubuno", Context.MODE_PRIVATE)

    var serverUrl: String?
        get() = prefs.getString("server_url", null)
        set(value) = prefs.edit().putString("server_url", value).apply()

    /** Stable per-install key sent as X-Kubuno-Device-Key (device inventory correlation). */
    val deviceKey: String
        get() = prefs.getString("device_key", null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString("device_key", it).apply()
        }

    var userDisplayName: String?
        get() = prefs.getString("user_display_name", null)
        set(value) = prefs.edit().putString("user_display_name", value).apply()

    var userEmail: String?
        get() = prefs.getString("user_email", null)
        set(value) = prefs.edit().putString("user_email", value).apply()
}
