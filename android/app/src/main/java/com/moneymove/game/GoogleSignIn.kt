package com.moneymove.game

import android.content.Context
import android.util.Log
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

/**
 * Signing in with Google.
 *
 * The server does the verifying: this hands it the ID token Google issued and
 * `POST /api/auth/google` checks the audience against the client ids it
 * knows. Nothing here is a secret — a client id is public, and the audience
 * check on the server is the only thing protecting anything.
 *
 * The id asked for is the **web** client id, not an Android one, because that
 * is the audience the server accepts and the one the browser and the iOS app
 * already use. Android still needs its own OAuth client registered in the
 * Google Cloud project — package name plus the signing SHA-1 — or Credential
 * Manager refuses before a token is ever minted. That is a console step only
 * the account's owner can do; until it is done this returns a plain refusal
 * rather than a crash, and the caller says so out loud.
 */
object GoogleSignIn {

    private const val TAG = "MMGoogle"

    /**
     * @return the ID token Google issued, or null with a reason.
     */
    suspend fun idToken(context: Context, serverClientId: String): Result<String> {
        if (serverClientId.isBlank()) {
            return Result.failure(IllegalStateException("This server has no Google sign-in configured"))
        }
        val option = GetGoogleIdOption.Builder()
            // Accounts already on the phone first. A player who has used the
            // app before should not be asked to choose out of a list of one.
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(serverClientId)
            .setAutoSelectEnabled(true)
            .build()

        return try {
            val response = CredentialManager.create(context).getCredential(
                context = context,
                request = GetCredentialRequest.Builder().addCredentialOption(option).build(),
            )
            val credential = response.credential
            val data = credential.data
            if (credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                return Result.failure(IllegalStateException("Google returned something unexpected"))
            }
            Result.success(GoogleIdTokenCredential.createFrom(data).idToken)
        } catch (e: GetCredentialException) {
            Log.w(TAG, "sign-in refused: ${e.message}")
            Result.failure(e)
        } catch (e: Exception) {
            Log.w(TAG, "sign-in failed: ${e.message}")
            Result.failure(e)
        }
    }
}
