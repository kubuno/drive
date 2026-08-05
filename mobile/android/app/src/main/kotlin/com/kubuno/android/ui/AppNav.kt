package com.kubuno.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.kubuno.android.api.KubunoClient
import com.kubuno.android.ui.home.HomeScreen
import com.kubuno.android.ui.home.HomeViewModel
import com.kubuno.android.ui.onboarding.LoginScreen
import com.kubuno.android.ui.onboarding.OnboardingViewModel
import com.kubuno.android.ui.onboarding.ServerScreen
import com.kubuno.android.ui.onboarding.TotpScreen

private object Routes {
    const val SERVER = "server"
    const val LOGIN = "login"
    const val TOTP = "totp"
    const val HOME = "home"
}

@Composable
fun AppNav() {
    val navController = rememberNavController()
    val onboarding: OnboardingViewModel = hiltViewModel()
    val onboardingState by onboarding.state.collectAsStateWithLifecycle()

    // Route the onboarding flow from its state (server -> login -> totp -> home).
    LaunchedEffect(
        onboardingState.serverValidated,
        onboardingState.totpSession,
        onboardingState.done,
    ) {
        val current = navController.currentBackStackEntry?.destination?.route
        when {
            onboardingState.done && current != Routes.HOME ->
                navController.navigate(Routes.HOME) { popUpTo(0) { inclusive = true } }
            onboardingState.totpSession != null && current == Routes.LOGIN ->
                navController.navigate(Routes.TOTP)
            onboardingState.serverValidated && current == Routes.SERVER ->
                navController.navigate(Routes.LOGIN)
            !onboardingState.serverValidated && current == Routes.LOGIN ->
                navController.popBackStack(Routes.SERVER, inclusive = false)
        }
    }

    val start = androidx.compose.runtime.remember { startDestination(onboarding.client) }

    NavHost(navController = navController, startDestination = start) {
        composable(Routes.SERVER) { ServerScreen(onboarding) }
        composable(Routes.LOGIN) { LoginScreen(onboarding) }
        composable(Routes.TOTP) { TotpScreen(onboarding) }
        composable(Routes.HOME) {
            val homeViewModel: HomeViewModel = hiltViewModel()
            HomeScreen(homeViewModel) {
                navController.navigate(Routes.LOGIN) { popUpTo(0) { inclusive = true } }
            }
        }
    }
}

private fun startDestination(client: KubunoClient): String = when {
    !client.hasServer() -> Routes.SERVER
    client.tokenManager.isLoggedIn() -> Routes.HOME
    else -> Routes.LOGIN
}
