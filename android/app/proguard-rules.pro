# What R8 must not take away.
#
# Everything here is something the app reaches for by name at runtime, which
# is exactly what a shrinker cannot see. A rule that is missing does not fail
# the build — it fails the release, on a phone, after the upload.

# ── kotlinx.serialization ──────────────────────────────────────────────────
# The generated serializers are referenced reflectively by the Json instance,
# and the @Serializable classes' field names ARE the wire protocol: rename one
# and the server's reply silently decodes to defaults.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class com.moneymove.game.** {
    *** Companion;
}
-keepclasseswithmembers class com.moneymove.game.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.moneymove.game.**$$serializer { *; }
-keep @kotlinx.serialization.Serializable class com.moneymove.game.** { *; }

# ── Socket.IO and its transport ────────────────────────────────────────────
# engine.io picks its transport classes by name.
-keep class io.socket.** { *; }
-keep class io.socket.engineio.** { *; }
-dontwarn io.socket.**
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.slf4j.**

# ── Play Billing ───────────────────────────────────────────────────────────
-keep class com.android.billingclient.api.** { *; }

# ── Reflection this app does on purpose ────────────────────────────────────
# PushRegistration looks up Firebase and Tasks by name so the app still builds
# and runs without them. If they ARE present, R8 must leave them findable.
-keep class com.google.firebase.messaging.FirebaseMessaging { *; }
-keep class com.google.android.gms.tasks.Tasks { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# Compose keeps its own rules via the library's consumer file; nothing to add.
