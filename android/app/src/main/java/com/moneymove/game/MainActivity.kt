package com.moneymove.game

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceError
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat

/**
 * MoneyMove on Android.
 *
 * The game itself is the same client the browser and the iOS app talk to, so
 * this is deliberately a thin shell: its whole job is to make that client feel
 * like an app — no browser chrome, a real back button, a launch screen instead
 * of a white flash, and an offline screen the player can actually act on.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var offline: View
    private var lastLoadFailed = false

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        setContentView(R.layout.activity_main)

        // A board game is watched, not read: nobody wants the screen dimming
        // while they wait for someone else's turn.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        offline = findViewById(R.id.offline)
        findViewById<View>(R.id.retry).setOnClickListener { reload() }

        web = findViewById(R.id.web)
        configure(web)
        web.loadUrl(startUrl())

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else confirmLeave()
            }
        })
    }

    /** A tapped invite link should land on that table, not the home screen. */
    private fun startUrl(): String {
        val link = intent?.data
        if (link != null && link.host in OURS) return link.toString()
        return "https://$HOST/"
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configure(web: WebView) {
        web.setBackgroundColor(Color.parseColor("#0C1310"))
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true          // the game keeps identity here
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false   // dice and coin sounds
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100                    // system font scaling would break the board
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        // Identity, coins and friends live in cookies/localStorage — losing them
        // on every launch would lose the player their seat.
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                // Anything that isn't the game itself belongs in the real browser.
                if (url.host in OURS) return false
                startActivity(Intent(Intent.ACTION_VIEW, url))
                return true
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                lastLoadFailed = false
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                // Sub-resources fail all the time; only a dead main page is worth a screen.
                if (request.isForMainFrame) showOffline()
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                if (!lastLoadFailed) showGame()
            }
        }
    }

    private fun showOffline() {
        lastLoadFailed = true
        offline.visibility = View.VISIBLE
        web.visibility = View.GONE
    }

    private fun showGame() {
        offline.visibility = View.GONE
        web.visibility = View.VISIBLE
    }

    private fun reload() {
        showGame()
        web.loadUrl(startUrl())
    }

    private fun confirmLeave() {
        AlertDialog.Builder(this)
            .setTitle(R.string.leave_title)
            .setMessage(R.string.leave_body)
            .setPositiveButton(R.string.leave_confirm) { _, _ -> finish() }
            .setNegativeButton(R.string.stay, null)
            .show()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.data?.let { if (it.host in OURS) web.loadUrl(it.toString()) }
    }

    override fun onPause() { super.onPause(); web.onPause() }
    override fun onResume() { super.onResume(); web.onResume() }

    private companion object {
        /** The address the game is actually called, and where it is loaded from. */
        const val HOST = "www.moneymove.live"

        /**
         * Every host that is really this game. The deploy host the site sits
         * behind still works, and links from before the custom domain still
         * open in the app rather than bouncing out to a browser.
         */
        val OURS = setOf(HOST, "moneymove.live", "money-up-nine.vercel.app")
    }
}
