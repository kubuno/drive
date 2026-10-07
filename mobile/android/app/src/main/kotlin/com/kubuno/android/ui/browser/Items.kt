package com.kubuno.android.ui.browser

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.CloudDone
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import coil3.compose.LocalPlatformContext
import coil3.request.ImageRequest
import com.kubuno.android.R
import com.kubuno.android.sync.db.FileEntity
import com.kubuno.android.sync.db.FolderEntity
import com.kubuno.android.ui.format.SizeUnits
import com.kubuno.android.ui.format.formatModified
import com.kubuno.android.ui.format.formatSize
import com.kubuno.android.ui.icons.FolderDefaultTint
import com.kubuno.android.ui.icons.FolderGlyph
import com.kubuno.android.ui.icons.badgeExtension
import com.kubuno.android.ui.icons.glyphFor
import com.kubuno.android.ui.icons.hasLargePreview
import com.kubuno.android.ui.theme.KubunoTheme

// Literal colours the web uses for explorer surfaces. They are not theme tokens
// there either — see core/frontend/src/drive/storage-explorer/*.
private val RowZebra = Color(0xFFFDFDFC)
private val CardBorder = Color(0xFFE8EAED)
private val FolderCardBg = Color(0xFFF3F4F5)
private val StarYellow = Color(0xFFFACC15)
private val ThumbBg = Color(0xFFF1F3F4)

@Composable
private fun sizeUnits() = SizeUnits(
    byte = stringResource(R.string.unit_byte),
    kb = stringResource(R.string.unit_kb),
    mb = stringResource(R.string.unit_mb),
    gb = stringResource(R.string.unit_gb),
)

/** Trailing kebab. 14dp glyph inside a 30dp touch slot, as on the web. */
@Composable
private fun Kebab(onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(30.dp)
            .clip(RoundedCornerShape(50))
            .combinedClickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Outlined.MoreVert,
            contentDescription = stringResource(R.string.actions_more),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(14.dp),
        )
    }
}

@Composable
private fun Thumbnail(file: FileEntity, baseUrl: String?, size: androidx.compose.ui.unit.Dp) {
    val glyph = glyphFor(file.mimeType, file.name)
    Box(
        modifier = Modifier
            .size(size)
            .clip(RoundedCornerShape(4.dp))
            .background(ThumbBg),
        contentAlignment = Alignment.Center,
    ) {
        if (hasLargePreview(file.mimeType, file.hasThumbnail) && baseUrl != null) {
            AsyncImage(
                model = ImageRequest.Builder(LocalPlatformContext.current)
                    .data("$baseUrl/api/v1/drive/${file.id}/thumbnail")
                    .memoryCacheKey("${file.id}@${file.etag}")
                    .diskCacheKey("${file.id}@${file.etag}")
                    .build(),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            // The web renders the 36px glyph at scale-75 inside a row thumb.
            Icon(glyph.icon, contentDescription = null, tint = glyph.tint, modifier = Modifier.size(27.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileRow(
    file: FileEntity,
    baseUrl: String?,
    zebra: Boolean,
    pinned: Boolean = false,
    onOpen: () -> Unit,
    onMenu: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (zebra) RowZebra else MaterialTheme.colorScheme.surface)
            .combinedClickable(onClick = onOpen, onLongClick = onMenu)
            .padding(horizontal = 8.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Thumbnail(file, baseUrl, 40.dp)
        Column(Modifier.weight(1f)) {
            Text(
                file.name,
                fontSize = 15.sp,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            val modified = formatModified(file.updatedAt)
            val meta = buildString {
                if (modified != null) append("${stringResource(R.string.row_modified)} $modified · ")
                append(formatSize(file.size, sizeUnits()))
            }
            Text(
                meta,
                style = MaterialTheme.typography.bodySmall,
                color = KubunoTheme.colors.textTertiary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (pinned) {
            Icon(
                Icons.Outlined.CloudDone,
                contentDescription = stringResource(R.string.pinned_badge),
                tint = KubunoTheme.colors.success,
                modifier = Modifier.size(13.dp),
            )
        }
        if (file.starred) {
            Icon(Icons.Filled.Star, contentDescription = null, tint = StarYellow, modifier = Modifier.size(13.dp))
        }
        Kebab(onMenu)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FolderRow(
    folder: FolderEntity,
    zebra: Boolean,
    onOpen: () -> Unit,
    onMenu: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (zebra) RowZebra else MaterialTheme.colorScheme.surface)
            .combinedClickable(onClick = onOpen, onLongClick = onMenu)
            .padding(horizontal = 8.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            FolderGlyph,
            contentDescription = null,
            tint = folder.tint(),
            modifier = Modifier.size(26.dp),
        )
        Column(Modifier.weight(1f)) {
            Text(
                folder.name,
                fontSize = 15.sp,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            formatModified(folder.updatedAt)?.let {
                Text(
                    "${stringResource(R.string.row_modified)} $it",
                    style = MaterialTheme.typography.bodySmall,
                    color = KubunoTheme.colors.textTertiary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (folder.starred) {
            Icon(Icons.Filled.Star, contentDescription = null, tint = StarYellow, modifier = Modifier.size(13.dp))
        }
        Kebab(onMenu)
    }
}

/** Folder cards are full-width horizontal chips, one per row, even in grid mode. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FolderCard(folder: FolderEntity, onOpen: () -> Unit, onMenu: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.large)
            .background(FolderCardBg)
            .border(1.dp, CardBorder, MaterialTheme.shapes.large)
            .combinedClickable(onClick = onOpen, onLongClick = onMenu)
            .padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(FolderGlyph, contentDescription = null, tint = folder.tint(), modifier = Modifier.size(24.dp))
        Text(
            folder.name,
            fontSize = 15.sp,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (folder.starred) {
            Icon(Icons.Filled.Star, contentDescription = null, tint = StarYellow, modifier = Modifier.size(14.dp))
        }
        Box(
            modifier = Modifier
                .size(30.dp)
                .clip(RoundedCornerShape(50))
                .combinedClickable(onClick = onMenu),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Outlined.MoreVert,
                contentDescription = stringResource(R.string.actions_more),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(16.dp),
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileCard(
    file: FileEntity,
    baseUrl: String?,
    pinned: Boolean = false,
    onOpen: () -> Unit,
    onMenu: () -> Unit,
) {
    val glyph = glyphFor(file.mimeType, file.name)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.large)
            .background(MaterialTheme.colorScheme.surfaceContainerLow)
            .border(1.dp, CardBorder, MaterialTheme.shapes.large)
            .combinedClickable(onClick = onOpen, onLongClick = onMenu),
    ) {
        // Header: type glyph, two-line name, star, kebab — top-aligned.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(glyph.icon, contentDescription = null, tint = glyph.tint, modifier = Modifier.size(18.dp))
            Text(
                file.name,
                style = MaterialTheme.typography.bodyMedium,
                lineHeight = 17.sp,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (pinned) {
                Icon(
                    Icons.Outlined.CloudDone,
                    contentDescription = stringResource(R.string.pinned_badge),
                    tint = KubunoTheme.colors.success,
                    modifier = Modifier.size(12.dp),
                )
            }
            if (file.starred) {
                Icon(Icons.Filled.Star, contentDescription = null, tint = StarYellow, modifier = Modifier.size(12.dp))
            }
            Box(
                modifier = Modifier
                    .size(24.dp)
                    .clip(RoundedCornerShape(50))
                    .combinedClickable(onClick = onMenu),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Outlined.MoreVert,
                    contentDescription = stringResource(R.string.actions_more),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(14.dp),
                )
            }
        }

        // Preview pane: fixed 128dp tall, white, inset 8dp.
        Box(
            modifier = Modifier
                .padding(start = 8.dp, end = 8.dp, bottom = 8.dp)
                .fillMaxWidth()
                .height(128.dp)
                .clip(MaterialTheme.shapes.medium)
                .background(MaterialTheme.colorScheme.surface),
            contentAlignment = Alignment.Center,
        ) {
            if (hasLargePreview(file.mimeType, file.hasThumbnail) && baseUrl != null) {
                AsyncImage(
                    model = ImageRequest.Builder(LocalPlatformContext.current)
                        .data("$baseUrl/api/v1/drive/${file.id}/thumbnail")
                        .memoryCacheKey("${file.id}@${file.etag}")
                        .diskCacheKey("${file.id}@${file.etag}")
                        .build(),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                Icon(glyph.icon, contentDescription = null, tint = glyph.tint, modifier = Modifier.size(40.dp))
            }

            badgeExtension(file.name)?.let { ext ->
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(4.dp),
                ) {
                    Text(
                        ext,
                        fontSize = 10.sp,
                        lineHeight = 12.sp,
                        letterSpacing = 0.4.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier
                            .clip(MaterialTheme.shapes.medium)
                            .background(MaterialTheme.colorScheme.surfaceContainerLow)
                            .padding(horizontal = 5.dp, vertical = 2.dp),
                    )
                }
            }
        }
    }
}

/** Section caption: "DOSSIERS" / "FICHIERS". */
@Composable
fun SectionTitle(text: String) {
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.bodySmall,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.6.sp,
        color = KubunoTheme.colors.textTertiary,
        modifier = Modifier.padding(bottom = 8.dp),
    )
}

@Composable
private fun FolderEntity.tint(): Color =
    color?.let { hex -> runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrNull() }
        ?: FolderDefaultTint

@Composable
fun RowDivider() {
    Spacer(
        Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(MaterialTheme.colorScheme.outline),
    )
}

@Composable
fun ListContainer(content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.large)
            .border(1.dp, MaterialTheme.colorScheme.outline, MaterialTheme.shapes.large),
    ) { content() }
}

@Composable
fun ControlSpacer(height: androidx.compose.ui.unit.Dp) = Spacer(Modifier.height(height))

@Composable
fun HorizontalSpacer(width: androidx.compose.ui.unit.Dp) = Spacer(Modifier.width(width))
