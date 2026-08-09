package com.kubuno.android.data

import android.content.Context
import java.util.UUID

/**
 * Device-wide, non-secret preferences.
 *
 * Anything tied to one account (server, profile, auto-upload) lives in
 * [AccountPrefs]; what remains here is true of the installation itself.
 * Plain SharedPreferences on purpose: everything here is either public or a
 * random identifier; tokens live in [com.kubuno.android.secure.FileTokenStore].
 */
class AppPrefs(context: Context) {
    private val prefs = context.getSharedPreferences("kubuno", Context.MODE_PRIVATE)

    /** Stable per-install key sent as X-Kubuno-Device-Key (device inventory correlation). */
    val deviceKey: String
        get() = prefs.getString("device_key", null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString("device_key", it).apply()
        }

}
