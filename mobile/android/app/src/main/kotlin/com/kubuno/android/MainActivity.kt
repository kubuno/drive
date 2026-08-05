package com.kubuno.android

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import com.kubuno.android.ui.AppNav
import com.kubuno.android.ui.theme.KubunoTheme
import dagger.hilt.android.AndroidEntryPoint

// AppCompatActivity (not ComponentActivity) so per-app locales keep working
// down to minSdk when the language picker lands in M5.
@AndroidEntryPoint
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            KubunoTheme {
                AppNav()
            }
        }
    }
}
