package com.kubuno.android.ui.account

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.kubuno.android.ui.components.KubunoButton
import com.kubuno.android.ui.components.KubunoButtonSize
import com.kubuno.android.ui.components.KubunoButtonVariant
import com.kubuno.android.ui.components.KubunoTextField
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.foundation.Image
import com.kubuno.android.R
import kotlin.math.max

/**
 * Circular crop, the mobile counterpart of the web's AvatarCropModal: pinch to
 * zoom, drag to frame, and the circle marks exactly what will be uploaded.
 *
 * The picture is laid out to *cover* the square, so no matter its aspect ratio
 * the circle is never left with an empty corner; zoom is floored at 1 for the
 * same reason.
 */
@Composable
fun AvatarCropDialog(
    bitmap: Bitmap,
    saving: Boolean,
    onSave: (CropState, Float) -> Unit,
    onDismiss: () -> Unit,
) {
    var state by remember { mutableStateOf(CropState()) }
    // Side of the crop square, needed to convert the framing on save.
    var viewportPx by remember { mutableStateOf(0f) }

    Dialog(
        onDismissRequest = { if (!saving) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.92f)),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                stringResource(R.string.avatar_crop_title),
                style = MaterialTheme.typography.titleMedium,
                color = Color.White,
                modifier = Modifier.padding(bottom = 24.dp),
            )

            BoxWithConstraints(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
                    .aspectRatio(1f)
                    .clipToBounds()
                    .pointerInput(Unit) {
                        detectTransformGestures { _, pan, gestureZoom, _ ->
                            val zoom = (state.zoom * gestureZoom).coerceIn(1f, 6f)
                            // Keep the picture covering the square: the free
                            // travel shrinks back to zero as zoom returns to 1.
                            val viewport = size.width.toFloat()
                            val base = max(viewport / bitmap.width, viewport / bitmap.height)
                            val scaled = base * zoom
                            val maxX = max(0f, (bitmap.width * scaled - viewport) / 2f)
                            val maxY = max(0f, (bitmap.height * scaled - viewport) / 2f)
                            state = CropState(
                                zoom = zoom,
                                offsetX = (state.offsetX + pan.x).coerceIn(-maxX, maxX),
                                offsetY = (state.offsetY + pan.y).coerceIn(-maxY, maxY),
                            )
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                val side = with(LocalDensity.current) { maxWidth.toPx() }
                viewportPx = side
                val base = max(side / bitmap.width, side / bitmap.height)

                Image(
                    bitmap = bitmap.asImageBitmap(),
                    contentDescription = null,
                    contentScale = ContentScale.None,
                    modifier = Modifier.graphicsLayer {
                        scaleX = base * state.zoom
                        scaleY = base * state.zoom
                        translationX = state.offsetX
                        translationY = state.offsetY
                    },
                )

                // Darken everything outside the circle so the framing reads.
                androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
                    drawIntoCanvas {
                        val radius = size.minDimension / 2f
                        drawRect(Color.Black.copy(alpha = 0.55f))
                        drawCircle(
                            color = Color.Transparent,
                            radius = radius,
                            blendMode = BlendMode.Clear,
                        )
                        drawCircle(
                            color = Color.White.copy(alpha = 0.9f),
                            radius = radius,
                            style = androidx.compose.ui.graphics.drawscope.Stroke(width = 2f),
                        )
                    }
                }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                KubunoButton(
                    text = stringResource(R.string.action_cancel),
                    onClick = onDismiss,
                    enabled = !saving,
                    variant = KubunoButtonVariant.GHOST,
                )
                KubunoButton(
                    text = stringResource(R.string.action_confirm),
                    onClick = { onSave(state, viewportPx) },
                    enabled = !saving,
                    loading = saving,
                )
            }
        }
    }
}

