import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

/**
 * Push, only where it can work.
 *
 * google-services.json names the Firebase project this app's notifications
 * come through. It is not a key, but this repo is public and the file is the
 * owner's, so it is gitignored and lives on his machine alone. The
 * google-services plugin does not degrade without it — it fails the build
 * outright — so it is applied only when the file is here. A clone without it
 * builds and runs as before: firebase-messaging is still linked, FirebaseApp
 * simply never initialises, and every call into Firebase asks whether it did
 * before it goes near it (see PushRegistration), so the whole of push is a
 * quiet no-op rather than a crash.
 */
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
} else {
    logger.warn("MoneyMove: no app/google-services.json — this build runs without push.")
}

/**
 * The AdMob application id this build carries in its manifest.
 *
 * Not a secret — it ships inside every app that serves AdMob — but the Google
 * Mobile Ads SDK reads it from a content provider of its own that runs before
 * Application.onCreate, and a missing or malformed one is an exception thrown
 * there: the app dies at launch before a line of ours has run, and nothing we
 * write can catch it. That is exactly how the SDK came out of this app the
 * first time.
 *
 * So the id lives where iOS keeps its own, in the build rather than the source
 * — the ADMOB_APP_ID Gradle property, looked for as `-P`, in gradle.properties
 * (this project's or ~/.gradle's), then in local.properties, then in the
 * environment — and whatever is found has to look like an AdMob app id before
 * it is let near the manifest. Anything else, including nothing at all, puts
 * Google's own published sample id there instead. That id is always
 * well-formed, so the worst a missing id can do is make every rewarded break a
 * house ad; AdMobNetwork refuses to spend live units under Google's sample app,
 * and says so. Pasting the real id in is one line, and no source changes.
 */
val googleSampleAdmobAppId = "ca-app-pub-3940256099942544~3347511713"
val admobAppId: String = run {
    val local = rootProject.file("local.properties").takeIf { it.isFile }?.let { f ->
        Properties().apply { f.inputStream().use { load(it) } }.getProperty("ADMOB_APP_ID")
    }
    val found = listOf(
        providers.gradleProperty("ADMOB_APP_ID").orNull,
        local,
        providers.environmentVariable("ADMOB_APP_ID").orNull,
    ).map { it?.trim().orEmpty() }.firstOrNull { it.isNotEmpty() }.orEmpty()
    when {
        found.matches(Regex("""ca-app-pub-\d+~\d+""")) -> found
        found.isEmpty() -> {
            logger.warn(
                "MoneyMove: no ADMOB_APP_ID — the manifest carries Google's sample app id, " +
                    "so AdMob serves test ads at most and every other break is a house ad.",
            )
            googleSampleAdmobAppId
        }
        else -> {
            logger.warn(
                "MoneyMove: ADMOB_APP_ID \"$found\" is not an AdMob app id " +
                    "(ca-app-pub-<digits>~<digits>) — using Google's sample id instead of crashing at launch.",
            )
            googleSampleAdmobAppId
        }
    }
}

android {
    namespace = "com.moneymove.game"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.moneymove.game"
        // The game is a socket and a board: there is nothing in it that needs
        // a recent phone, and Android's long tail is where its players are.
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        // Read by the manifest's APPLICATION_ID line. Always a well-formed id
        // by the time it gets here — see admobAppId above for why that matters.
        manifestPlaceholders["admobAppId"] = admobAppId
    }

    /**
     * Release signing, read from the environment.
     *
     * Play signs releases with a key that must never be lost — losing it means
     * never updating the app again — so the keystore and its passwords stay
     * out of this repo entirely and out of this file. Set the four variables
     * and `./gradlew bundleRelease` works; leave them unset and the release
     * build simply goes out unsigned rather than failing in a way that looks
     * like a broken build.
     */
    val keystore = System.getenv("MM_KEYSTORE")?.let(::file)?.takeIf { it.exists() }
    signingConfigs {
        if (keystore != null) {
            create("release") {
                storeFile = keystore
                storePassword = System.getenv("MM_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("MM_KEY_ALIAS") ?: "moneymove"
                keyPassword = System.getenv("MM_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            // R8 on, because a Compose app ships a lot of code it never runs
            // and Play's download size is a real number people look at.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (keystore != null) signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ""
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // Socket.IO's client and OkHttp reach for java.time on older phones.
        isCoreLibraryDesugaringEnabled = true
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "META-INF/INDEX.LIST")
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.animation:animation")

    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    // The same transport the browser and the iOS app use, so one server speaks
    // to all three without a second protocol to keep in step.
    implementation("io.socket:socket.io-client:2.1.1") {
        exclude(group = "org.json", module = "json")
    }
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // Google Sign-In through Credential Manager, which is the only way in on
    // a modern phone — the old GoogleSignInClient is deprecated and gone.
    implementation("androidx.credentials:credentials:1.3.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")

    // Google Play Billing. The coin packs are the only thing in this app that
    // costs real money, and Play is the only way to take it on Android.
    implementation("com.android.billingclient:billing:7.1.1")

    // Google Mobile Ads, the same network the iOS app sells its breaks on.
    // Its own minSdk is 23, under this app's 24, so nothing about who can
    // install the game changes by adding it. Pinned at 24.8.0 on evidence:
    // from 24.9.0 on, the SDK ships Kotlin 2.2 and then 2.3 metadata, and the
    // 2.0.21 compiler this project uses reads one version ahead and no
    // further — 25.5.0 fails compileDebugKotlin outright. Moving past this
    // line means raising the Kotlin plugin in the root build first.
    //
    // It is safe to link before the AdMob account has an Android app in it
    // only because the manifest's APPLICATION_ID can never be missing or
    // malformed — see admobAppId at the top of this file.
    implementation("com.google.android.gms:play-services-ads:24.8.0")

    // Firebase Cloud Messaging: the Android end of what push.js sends, which
    // Apple's end has been doing for the iPhone. Messaging alone — no
    // analytics, because the app measures nothing it does not have to (see
    // DELAY_APP_MEASUREMENT_INIT in the manifest). The BoM pins messaging at
    // 25.1.3, which is built on Kotlin 2.0.21, the compiler this project
    // uses, so it does not run into the metadata wall the ads SDK did. It is
    // linked whether or not google-services.json is here; see the top of
    // this file for why that is safe.
    implementation(platform("com.google.firebase:firebase-bom:34.19.0"))
    implementation("com.google.firebase:firebase-messaging")

    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.3")

    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
}
