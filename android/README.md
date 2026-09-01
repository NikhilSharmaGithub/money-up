# MoneyMove for Android

The Android client is a thin native shell around the same game client the browser
and the iOS app already run, pointed at the live site
(`https://money-up-nine.vercel.app`). That means one game, one set of rules, and
every server deploy reaching Android players the moment it lands — no store
review in between.

The shell's job is the part a browser tab can't do: no address bar, a real back
button, a launch screen instead of a white flash, cookies and localStorage that
survive a restart (identity, coins and friends live there), the screen staying
awake during someone else's turn, and an offline screen with a Retry button
instead of Chrome's grey error page. Invite links to the game's domain open the
table straight in the app.

## Build a debug APK

Nothing to install — Android Studio's bundled JDK and SDK are enough:

```bash
cd android
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
  ./gradlew assembleDebug
```

The APK lands in `app/build/outputs/apk/debug/app-debug.apk`.

Run it on an emulator:

```bash
$ANDROID_HOME/emulator/emulator -avd Medium_Phone_API_36.1 &
$ANDROID_HOME/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk
$ANDROID_HOME/platform-tools/adb shell am start -n com.moneymove.game/.MainActivity
```

## Shipping to Google Play — what only you can do

1. **A Play Console account — $25, one time.** <https://play.google.com/console/signup>.
   This is the only purchase Android needs.
2. **A signing keystore.** Play signs releases with a key that must never be lost —
   losing it means never updating the app again. Generate it yourself and back it up:

   ```bash
   keytool -genkey -v -keystore moneymove-release.jks \
     -keyalg RSA -keysize 2048 -validity 10000 -alias moneymove
   ```

   Keep the file and its passwords out of this repo (`.gitignore` already blocks
   `*.jks` and `*.keystore`).
3. **Build the release bundle** once the keystore exists — add a `signingConfigs`
   block to `app/build.gradle.kts` reading the passwords from environment
   variables, then `./gradlew bundleRelease`. The AAB is what Play wants.
4. **Listing copy** — reuse `APPSTORE.md` at the repo root; Play asks for the same
   things (title, short and full description, screenshots, a privacy policy URL,
   and a data-safety form that matches `public/privacy.html`).

## Notes

- `local.properties` is generated per machine and is gitignored.
- The launcher icon is derived from the iOS app icon so all three platforms carry
  the same mark; the adaptive icon layers live in `res/mipmap-anydpi-v26/`.
