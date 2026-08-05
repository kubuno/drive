package com.kubuno.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.kubuno.android.api.KubunoClient
import com.kubuno.android.ui.browser.BrowserScreen
import com.kubuno.android.ui.onboarding.LoginScreen
import com.kubuno.android.ui.onboarding.OnboardingViewModel
import com.kubuno.android.ui.onboarding.ServerScreen
import com.kubuno.android.ui.onboarding.TotpScreen

private object Routes {
    const val SERVER = "server"
    const val LOGIN = "login"
    const val TOTP = "totp"
    const val BROWSER = "browser"
    const val BROWSER_FOLDER = "browser/{folderId}"
}

@Composable
fun AppNav() {
    val navController = rememberNavController()
    val onboarding: OnboardingViewModel = hiltViewModel()
    val onboardingState by onboarding.state.collectAsStateWithLifecycle()

    // Route the onboarding flow from its state (server -> login -> totp -> browser).
    LaunchedEffect(
        onboardingState.serverValidated,
        onboardingState.totpSession,
        onboardingState.done,
    ) {
        val current = navController.currentBackStackEntry?.destination?.route
        when {
            onboardingState.done && current != Routes.BROWSER ->
                navController.navigate(Routes.BROWSER) { popUpTo(0) { inclusive = true } }
            onboardingState.totpSession != null && current == Routes.LOGIN ->
                navController.navigate(Routes.TOTP)
            onboardingState.serverValidated && current == Routes.SERVER ->
                navController.navigate(Routes.LOGIN)
            !onboardingState.serverValidated && current == Routes.LOGIN ->
                navController.popBackStack(Routes.SERVER, inclusive = false)
        }
    }

    val start = remember { startDestination(onboarding.client) }
    val onLoggedOut = {
        navController.navigate(Routes.LOGIN) { popUpTo(0) { inclusive = true } }
    }

    NavHost(navController = navController, startDestination = start) {
        composable(Routes.SERVER) { ServerScreen(onboarding) }
        composable(Routes.LOGIN) { LoginScreen(onboarding) }
        composable(Routes.TOTP) { TotpScreen(onboarding) }
        composable(Routes.BROWSER) {
            BrowserScreen(
                viewModel = hiltViewModel(),
                onOpenFolder = { id -> navController.navigate("browser/$id") },
                onBack = {},
                onLoggedOut = onLoggedOut,
            )
        }
        composable(
            Routes.BROWSER_FOLDER,
            arguments = listOf(navArgument("folderId") { type = NavType.StringType }),
        ) {
            BrowserScreen(
                viewModel = hiltViewModel(),
                onOpenFolder = { id -> navController.navigate("browser/$id") },
                onBack = { navController.popBackStack() },
                onLoggedOut = onLoggedOut,
            )
        }
    }
}

private fun startDestination(client: KubunoClient): String = when {
    !client.hasServer() -> Routes.SERVER
    client.tokenManager.isLoggedIn() -> Routes.BROWSER
    else -> Routes.LOGIN
}
