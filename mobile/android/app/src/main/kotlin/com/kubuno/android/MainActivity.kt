package com.kubuno.android

import android.accounts.AccountAuthenticatorResponse
import android.accounts.AccountManager
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.kubuno.android.account.AccountId
import com.kubuno.android.account.AccountManagerBridge
import com.kubuno.android.account.KubunoAccounts
import com.kubuno.android.ui.AppNav
import com.kubuno.android.ui.theme.KubunoTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.coroutines.launch

// AppCompatActivity (not ComponentActivity) so per-app locales keep working
// down to minSdk when the language picker lands in M5.
@AndroidEntryPoint
class MainActivity : AppCompatActivity() {

    @Inject lateinit var accountBridge: AccountManagerBridge

    /**
     * Set when the system's account settings launched us to add or repair an
     * account. It must be answered exactly once, otherwise the caller's
     * `AccountManagerFuture` never completes.
     */
    private var authenticatorResponse: AccountAuthenticatorResponse? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        @Suppress("DEPRECATION") // the typed getParcelableExtra is API 33+
        authenticatorResponse = intent
            .getParcelableExtra(AccountManager.KEY_ACCOUNT_AUTHENTICATOR_RESPONSE)
        authenticatorResponse?.onRequestContinued()

        // Both entry points land on sign-in: adding a new account, and
        // re-authenticating one whose session died.
        val addingAccount = authenticatorResponse != null ||
            intent.getBooleanExtra(KubunoAccounts.EXTRA_ADD_ACCOUNT, false)

        enableEdgeToEdge()
        setContent {
            KubunoTheme {
                AppNav(
                    startAddingAccount = addingAccount,
                    onAccountAdded = ::answerAuthenticator,
                )
            }
        }
    }

    /**
     * Hands the freshly registered account back to whoever asked for it, then
     * steps aside: the user came from the system settings, not from us.
     */
    private fun answerAuthenticator(id: AccountId) {
        val response = authenticatorResponse ?: return
        authenticatorResponse = null
        lifecycleScope.launch {
            // The mirror is driven by a flow, so the system account may not
            // exist yet; syncing here makes the name available right away.
            runCatching { accountBridge.sync() }
            val name = accountBridge.systemName(id)
            if (name == null) {
                response.onError(AccountManager.ERROR_CODE_CANCELED, "Account was not registered")
            } else {
                response.onResult(
                    Bundle().apply {
                        putString(AccountManager.KEY_ACCOUNT_NAME, name)
                        putString(AccountManager.KEY_ACCOUNT_TYPE, KubunoAccounts.TYPE)
                    }
                )
            }
            finish()
        }
    }

    /** A cancelled sign-in must still release the caller. */
    override fun finish() {
        authenticatorResponse?.onError(AccountManager.ERROR_CODE_CANCELED, "Sign-in cancelled")
        authenticatorResponse = null
        super.finish()
    }
}
