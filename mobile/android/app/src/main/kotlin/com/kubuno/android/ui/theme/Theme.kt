package com.kubuno.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val KubunoIndigo = Color(0xFF4F46E5)
private val KubunoIndigoLight = Color(0xFFBFC3FF)
private val KubunoIndigoDark = Color(0xFF2E2A9E)

private val LightColors = lightColorScheme(
    primary = KubunoIndigo,
    onPrimary = Color.White,
    primaryContainer = KubunoIndigoLight,
    onPrimaryContainer = Color(0xFF171A66),
)

private val DarkColors = darkColorScheme(
    primary = KubunoIndigoLight,
    onPrimary = KubunoIndigoDark,
    primaryContainer = KubunoIndigoDark,
    onPrimaryContainer = KubunoIndigoLight,
)

@Composable
fun KubunoTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
