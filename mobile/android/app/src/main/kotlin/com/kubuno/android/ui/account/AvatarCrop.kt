package com.kubuno.android.ui.account

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

/** Side of the square we upload. The web's avatars are served at 256. */
const val AVATAR_OUTPUT_PX = 512

/** Longest side we decode into memory before cropping. */
private const val MAX_DECODE_PX = 2048

/**
 * The user's framing, expressed the way the crop surface manipulates it:
 * [zoom] multiplies the "cover" scale, and [offsetX]/[offsetY] shift the image
 * in viewport pixels from centred.
 */
data class CropState(
    val zoom: Float = 1f,
    val offsetX: Float = 0f,
    val offsetY: Float = 0f,
)

/**
 * Decodes [uri] at a workable size, honouring the EXIF rotation phones write
 * instead of rotating pixels — without it a portrait photo lands sideways.
 */
fun loadBitmap(context: Context, uri: Uri): Bitmap? = runCatching {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    val longest = max(bounds.outWidth, bounds.outHeight)
    val options = BitmapFactory.Options().apply {
        inSampleSize = generateSequence(1) { it * 2 }.first { longest / it <= MAX_DECODE_PX }
    }
    val decoded = context.contentResolver.openInputStream(uri)
        ?.use { BitmapFactory.decodeStream(it, null, options) } ?: return null

    val orientation = context.contentResolver.openInputStream(uri)?.use {
        ExifInterface(it).getAttributeInt(
            ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL
        )
    } ?: ExifInterface.ORIENTATION_NORMAL

    val matrix = Matrix()
    when (orientation) {
        ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
        ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
        ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
        else -> return@runCatching decoded
    }
    Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
}.getOrNull()

/**
 * Turns the on-screen framing into the pixels behind the circle.
 *
 * The viewport is a square of side [viewportPx]. The bitmap is laid out to
 * *cover* it, so the base scale is the larger of the two ratios; [state] then
 * zooms and shifts that. Mapping a viewport point back to the source is the
 * inverse of that transform, which gives the source-space square to cut.
 */
fun cropToSquare(source: Bitmap, viewportPx: Float, state: CropState): Bitmap {
    val baseScale = max(viewportPx / source.width, viewportPx / source.height)
    val scale = baseScale * state.zoom

    val sizeInSource = viewportPx / scale
    val left = (-viewportPx / 2f - state.offsetX) / scale + source.width / 2f
    val top = (-viewportPx / 2f - state.offsetY) / scale + source.height / 2f

    // Clamp inside the bitmap: a fast pan can overshoot by a pixel or two.
    val side = sizeInSource.coerceAtMost(minOf(source.width, source.height).toFloat())
    val x = left.coerceIn(0f, source.width - side)
    val y = top.coerceIn(0f, source.height - side)

    val cropped = Bitmap.createBitmap(
        source, x.roundToInt(), y.roundToInt(), side.roundToInt(), side.roundToInt()
    )
    return if (cropped.width == AVATAR_OUTPUT_PX) cropped
    else Bitmap.createScaledBitmap(cropped, AVATAR_OUTPUT_PX, AVATAR_OUTPUT_PX, true)
}

/** JPEG bytes; quality 90 keeps a 512px portrait well under the 10 MB cap. */
fun Bitmap.toJpeg(quality: Int = 90): ByteArray = ByteArrayOutputStream().use { out ->
    compress(Bitmap.CompressFormat.JPEG, quality, out)
    out.toByteArray()
}
