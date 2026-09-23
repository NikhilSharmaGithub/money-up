plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
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

    // No AdMob SDK yet, deliberately. It refuses to start without an
    // APPLICATION_ID in the manifest — it does not warn, it crashes the app on
    // launch — and there is no Android app in the AdMob account to give it an
    // id from. The whole rewarded path (offer, ticket, view, server-verified
    // reward, daily caps) is live and carried by the house ad; adding the SDK
    // is then one dependency, one manifest line and one adapter.

    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.3")

    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
}
