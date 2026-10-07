package com.kubuno.android.ui.icons

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.FolderZip
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.TextFields
import androidx.compose.material.icons.outlined.ViewInAr
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector

/**
 * File type glyphs and their tints, transcribed from the web's getFileIcon
 * (core/frontend/src/drive/filesShared.tsx). Colours are the literal Tailwind
 * v4 values the web resolves to. Lucide has no Compose port, so each glyph maps
 * to its closest Material Symbols equivalent.
 */
data class FileGlyph(val icon: ImageVector, val tint: Color)

private val Blue400 = Color(0xFF51A2FF)
private val Purple400 = Color(0xFFC27AFF)
private val Green400 = Color(0xFF05DF72)
private val Red400 = Color(0xFFFF6467)
private val Blue500 = Color(0xFF2B7FFF)
private val Green500 = Color(0xFF00C951)
private val Orange400 = Color(0xFFFF8904)
private val Cyan500 = Color(0xFF00B8DB)
private val Violet500 = Color(0xFF8E51FF)
private val TextTertiary = Color(0xFF80868B)

/** Default folder tint when the folder carries no colour of its own. */
val FolderDefaultTint = Color(0xFF5F6368)

val FolderGlyph = Icons.Filled.Folder

fun glyphFor(mimeType: String?, name: String?): FileGlyph {
    val mime = mimeType.orEmpty()
    val ext = name?.substringAfterLast('.', "")?.lowercase().orEmpty()
    return when {
        mime.startsWith("image/") -> FileGlyph(Icons.Outlined.Image, Blue400)
        mime.startsWith("video/") -> FileGlyph(Icons.Outlined.Movie, Purple400)
        mime.startsWith("audio/") -> FileGlyph(Icons.Outlined.MusicNote, Green400)
        mime == "application/pdf" -> FileGlyph(Icons.Outlined.Description, Red400)
        mime.contains("word") || mime.contains("opendocument.text") ->
            FileGlyph(Icons.Outlined.Description, Blue500)
        mime.contains("excel") || mime.contains("spreadsheet") || mime.contains("csv") ->
            FileGlyph(Icons.Outlined.Description, Green500)
        mime.contains("powerpoint") || mime.contains("presentation") ->
            FileGlyph(Icons.Outlined.Description, Orange400)
        mime.contains("zip") || mime.contains("tar") || mime.contains("rar") || mime.contains("7z") ->
            FileGlyph(Icons.Outlined.FolderZip, TextTertiary)
        mime.startsWith("model/") || ext in listOf("glb", "gltf", "obj", "stl", "ply") ->
            FileGlyph(Icons.Outlined.ViewInAr, Cyan500)
        mime.startsWith("font/") || ext in listOf("ttf", "otf", "woff", "woff2", "eot") ->
            FileGlyph(Icons.Outlined.TextFields, Violet500)
        else -> FileGlyph(Icons.AutoMirrored.Outlined.InsertDriveFile, TextTertiary)
    }
}

/** Uppercase extension shown in the card's corner badge; null when not badge-worthy. */
fun badgeExtension(name: String): String? {
    val ext = name.substringAfterLast('.', "")
    return if (ext.matches(Regex("^[A-Za-z0-9]{1,5}$"))) ext.uppercase() else null
}

/** Only images and videos get a real thumbnail; everything else shows its glyph. */
fun hasLargePreview(mimeType: String?, hasThumbnail: Boolean): Boolean {
    val mime = mimeType.orEmpty()
    return hasThumbnail && (mime.startsWith("image/") || mime.startsWith("video/"))
}
