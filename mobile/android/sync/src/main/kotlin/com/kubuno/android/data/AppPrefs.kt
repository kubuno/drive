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

    // ---- camera-roll auto-upload ----------------------------------------

    var autoUploadEnabled: Boolean
        get() = prefs.getBoolean("auto_upload", false)
        set(value) = prefs.edit().putBoolean("auto_upload", value).apply()

    var autoUploadWifiOnly: Boolean
        get() = prefs.getBoolean("auto_upload_wifi", true)
        set(value) = prefs.edit().putBoolean("auto_upload_wifi", value).apply()

    var autoUploadWhileCharging: Boolean
        get() = prefs.getBoolean("auto_upload_charging", false)
        set(value) = prefs.edit().putBoolean("auto_upload_charging", value).apply()

    var autoUploadVideos: Boolean
        get() = prefs.getBoolean("auto_upload_videos", false)
        set(value) = prefs.edit().putBoolean("auto_upload_videos", value).apply()

    /**
     * Only media added after this instant are considered, so switching the
     * feature on does not suddenly push years of photos. Seconds since epoch,
     * matching MediaStore's DATE_ADDED.
     */
    var autoUploadSince: Long
        get() = prefs.getLong("auto_upload_since", 0L)
        set(value) = prefs.edit().putLong("auto_upload_since", value).apply()

    /** Server id of the destination folder, resolved once then reused. */
    var autoUploadFolderId: String?
        get() = prefs.getString("auto_upload_folder", null)
        set(value) = prefs.edit().putString("auto_upload_folder", value).apply()
}
