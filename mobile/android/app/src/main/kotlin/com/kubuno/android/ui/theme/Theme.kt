package com.kubuno.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Design tokens transcribed from the web design system
// (core/frontend/src/theme.css and core/themes/kubuno-reference).
// The reference theme is the source of truth; do not invent shades here.
private object Ref {
    val Primary = Color(0xFF1A73E8)
    val PrimaryHover = Color(0xFF1557B0)
    val PrimaryLight = Color(0xFFD3E3FD)
    val NavActive = Color(0xFF041E49)
    val BodyBg = Color(0xFFF1F4F8)
    val Surface0 = Color(0xFFFFFFFF)
    val Surface1 = Color(0xFFF8F9FA)
    val Surface2 = Color(0xFFF1F3F4)
    val Surface3 = Color(0xFFE8EAED)
    val Border = Color(0xFFE0E0E0)
    val BorderStrong = Color(0xFFBDC1C6)
    val TextPrimary = Color(0xFF202124)
    val TextSecondary = Color(0xFF5F6368)
    val TextTertiary = Color(0xFF80868B)
    val Danger = Color(0xFFD93025)
    val DangerLight = Color(0xFFFCE8E6)
    val Success = Color(0xFF1E8E3E)
    val SuccessLight = Color(0xFFE6F4EA)
    val Warning = Color(0xFFF9AB00)
    val WarningLight = Color(0xFFFEF7E0)

    // kubuno-dark
    val DarkPrimary = Color(0xFF8AB4F8)
    val DarkPrimaryContainer = Color(0xFF1A3A5C)
    val DarkNavActive = Color(0xFFAECBFA)
    val DarkBodyBg = Color(0xFF17181B)
    val DarkSurface0 = Color(0xFF202124)
    val DarkSurface1 = Color(0xFF292A2D)
    val DarkSurface2 = Color(0xFF35363A)
    val DarkSurface3 = Color(0xFF444746)
    val DarkBorder = Color(0xFF5F6368)
    val DarkBorderStrong = Color(0xFF80868B)
    val DarkTextPrimary = Color(0xFFE8EAED)
    val DarkTextSecondary = Color(0xFF9AA0A6)
    val DarkDanger = Color(0xFFF28B82)
    val DarkDangerLight = Color(0xFF3D1C1C)
    val DarkSuccess = Color(0xFF81C995)
    val DarkWarning = Color(0xFFFDD663)

    // [data-module="drive"] scoped tokens
    val DriveRowSelected = Color(0xFFE8F0FE)
    val DriveHover = Color(0xFFE4ECF7)
    val DarkDriveRowSelected = Color(0xFF22344D)
    val DarkDriveHover = Color(0xFF2B2C30)
}

/** Tokens that Material 3 has no slot for but the web design system defines. */
data class KubunoExtendedColors(
    val success: Color,
    val successContainer: Color,
    val warning: Color,
    val warningContainer: Color,
    val textTertiary: Color,
    val borderStrong: Color,
    val navActive: Color,
    val driveRowSelected: Color,
    val driveHover: Color,
)

val LocalKubunoColors = staticCompositionLocalOf {
    KubunoExtendedColors(
        success = Ref.Success,
        successContainer = Ref.SuccessLight,
        warning = Ref.Warning,
        warningContainer = Ref.WarningLight,
        textTertiary = Ref.TextTertiary,
        borderStrong = Ref.BorderStrong,
        navActive = Ref.NavActive,
        driveRowSelected = Ref.DriveRowSelected,
        driveHover = Ref.DriveHover,
    )
}

private val LightColors = lightColorScheme(
    primary = Ref.Primary,
    onPrimary = Color.White,
    primaryContainer = Ref.PrimaryLight,
    onPrimaryContainer = Ref.NavActive,
    secondary = Ref.Primary,
    onSecondary = Color.White,
    // The shell paints the page in --body-bg and lays a white module card on it.
    background = Ref.BodyBg,
    onBackground = Ref.TextPrimary,
    surface = Ref.Surface0,
    onSurface = Ref.TextPrimary,
    surfaceVariant = Ref.Surface2,
    onSurfaceVariant = Ref.TextSecondary,
    surfaceContainerLowest = Ref.Surface0,
    surfaceContainerLow = Ref.Surface1,
    surfaceContainer = Ref.Surface2,
    surfaceContainerHigh = Ref.Surface3,
    surfaceContainerHighest = Ref.Surface3,
    outline = Ref.Border,
    outlineVariant = Ref.BorderStrong,
    error = Ref.Danger,
    onError = Color.White,
    errorContainer = Ref.DangerLight,
    onErrorContainer = Ref.Danger,
)

private val DarkColors = darkColorScheme(
    primary = Ref.DarkPrimary,
    onPrimary = Ref.DarkSurface0,
    primaryContainer = Ref.DarkPrimaryContainer,
    onPrimaryContainer = Ref.DarkNavActive,
    secondary = Ref.DarkPrimary,
    onSecondary = Ref.DarkSurface0,
    background = Ref.DarkBodyBg,
    onBackground = Ref.DarkTextPrimary,
    surface = Ref.DarkSurface0,
    onSurface = Ref.DarkTextPrimary,
    surfaceVariant = Ref.DarkSurface2,
    onSurfaceVariant = Ref.DarkTextSecondary,
    surfaceContainerLowest = Ref.DarkBodyBg,
    surfaceContainerLow = Ref.DarkSurface1,
    surfaceContainer = Ref.DarkSurface2,
    surfaceContainerHigh = Ref.DarkSurface3,
    surfaceContainerHighest = Ref.DarkSurface3,
    outline = Ref.DarkBorder,
    outlineVariant = Ref.DarkBorderStrong,
    error = Ref.DarkDanger,
    onError = Ref.DarkSurface0,
    errorContainer = Ref.DarkDangerLight,
    onErrorContainer = Ref.DarkDanger,
)

/**
 * Radii are deliberately small and flat: the web scale caps at 8px for cards
 * (--radius-xl == --radius-2xl, the old 16px "read too round").
 */
val KubunoShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = RoundedCornerShape(4.dp),
    medium = RoundedCornerShape(6.dp),
    large = RoundedCornerShape(8.dp),
    extraLarge = RoundedCornerShape(8.dp),
)

/**
 * Body text is 14sp/20sp. Two project rules travel with this scale:
 * `font-medium` renders at 600 (SemiBold), and buttons are never bold.
 */
private val Sans = FontFamily.Default

val KubunoTypography = Typography(
    headlineMedium = TextStyle(fontFamily = Sans, fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.Normal),
    headlineSmall = TextStyle(fontFamily = Sans, fontSize = 20.sp, lineHeight = 28.sp, fontWeight = FontWeight.Normal),
    titleLarge = TextStyle(fontFamily = Sans, fontSize = 18.sp, lineHeight = 24.sp, fontWeight = FontWeight.Normal),
    titleMedium = TextStyle(fontFamily = Sans, fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold),
    titleSmall = TextStyle(fontFamily = Sans, fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontFamily = Sans, fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.Normal),
    bodyMedium = TextStyle(fontFamily = Sans, fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Normal),
    bodySmall = TextStyle(fontFamily = Sans, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Normal),
    labelLarge = TextStyle(fontFamily = Sans, fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Normal),
    labelMedium = TextStyle(fontFamily = Sans, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Normal),
    labelSmall = TextStyle(fontFamily = Sans, fontSize = 11.sp, lineHeight = 16.sp, fontWeight = FontWeight.Normal),
)

object KubunoTheme {
    val colors: KubunoExtendedColors
        @Composable @ReadOnlyComposable get() = LocalKubunoColors.current
}

@Composable
fun KubunoTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val extended = if (darkTheme) {
        KubunoExtendedColors(
            success = Ref.DarkSuccess,
            successContainer = Color(0xFF1A3A27),
            warning = Ref.DarkWarning,
            warningContainer = Color(0xFF3D3218),
            textTertiary = Ref.TextTertiary,
            borderStrong = Ref.DarkBorderStrong,
            navActive = Ref.DarkNavActive,
            driveRowSelected = Ref.DarkDriveRowSelected,
            driveHover = Ref.DarkDriveHover,
        )
    } else {
        KubunoExtendedColors(
            success = Ref.Success,
            successContainer = Ref.SuccessLight,
            warning = Ref.Warning,
            warningContainer = Ref.WarningLight,
            textTertiary = Ref.TextTertiary,
            borderStrong = Ref.BorderStrong,
            navActive = Ref.NavActive,
            driveRowSelected = Ref.DriveRowSelected,
            driveHover = Ref.DriveHover,
        )
    }

    CompositionLocalProvider(LocalKubunoColors provides extended) {
        MaterialTheme(
            colorScheme = if (darkTheme) DarkColors else LightColors,
            shapes = KubunoShapes,
            typography = KubunoTypography,
            content = content,
        )
    }
}
