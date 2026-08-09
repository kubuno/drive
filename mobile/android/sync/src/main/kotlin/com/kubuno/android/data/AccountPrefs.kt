package com.kubuno.android.data

import android.content.Context
import com.kubuno.android.account.AccountId

/**
 * Per-account preferences, in their own SharedPreferences file.
 *
 * Everything here is account-scoped by nature: the auto-upload destination is
 * a *server* folder id, and the MediaStore checkpoint decides what a given
 * account has already seen. Sharing either between accounts would send photos
 * to the wrong drive. Device-wide settings stay in [AppPrefs].
 */
class AccountPrefs(context: Context, accountId: AccountId) {
    private val prefs = context.getSharedPreferences(
        "kubuno-account-${accountId.value}", Context.MODE_PRIVATE
    )

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

    /** Seconds since epoch; only media added after this are considered. */
    var autoUploadSince: Long
        get() = prefs.getLong("auto_upload_since", 0L)
        set(value) = prefs.edit().putLong("auto_upload_since", value).apply()

    /** Server id of the destination folder on *this* account's instance. */
    var autoUploadFolderId: String?
        get() = prefs.getString("auto_upload_folder", null)
        set(value) = prefs.edit().putString("auto_upload_folder", value).apply()

    /** Wipes the file when the account is removed. */
    fun erase() = prefs.edit().clear().apply()
}
