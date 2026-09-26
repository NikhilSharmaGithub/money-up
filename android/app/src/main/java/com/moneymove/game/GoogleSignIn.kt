package com.moneymove.game

import android.content.Context
import android.util.Log
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
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
 * already use. Android still needs its own OAuth client registered in the same
 * Google Cloud project — package name plus the signing SHA-1 — or Credential
 * Manager refuses before a token is ever minted. The debug build's client
 * ("MoneyMove Android (debug)") was registered on 2026-09-26; a release build
 * signed with another key, and Play's own app-signing key, each need their
 * SHA-1 added to it the same way.
 *
 * It asks with the button flow, not the one-tap one. GetGoogleIdOption only
 * ever offers accounts already on the phone, so on a phone with none — or with
 * none the user wants — it failed straight away with "No credentials
 * available" and the button looked broken. GetSignInWithGoogleOption is what
 * Google gives a "Sign in with Google" button: the full sheet, with every
 * account on the phone and the way to add another.
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
        val option = GetSignInWithGoogleOption.Builder(serverClientId).build()

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
