plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.0.21" apply false
    // Turns app/google-services.json into the resources FirebaseApp reads at
    // launch. Declared here and applied by the app module only when that file
    // is there, because the repo is public and the file is not in it — see
    // app/build.gradle.kts. 4.4.4 is the last of the line built for the
    // Gradle 8 this project runs; 4.5.0 is built with Gradle 9 and has not
    // been tried against it.
    id("com.google.gms.google-services") version "4.4.4" apply false
}
