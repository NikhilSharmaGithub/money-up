# MoneyMove for Android

A native Kotlin and Jetpack Compose client — the same app as the iOS one, not
a browser in a frame. It talks to the same Socket.IO server, decodes the same
state, replays the same move legs on the same cue sheet, and draws the same
glyphs on the same 32×32 grid, so a phone, a tablet and a browser can sit at
one table and watch the same game happen at the same speed.

## How it lines up with the other two clients

| Piece | Android | iOS | Web |
| --- | --- | --- | --- |
| Design system | `Theme.kt` | `Theme.swift` | `css/style.css` |
| Wire models | `Models.kt` | `Models.swift` | (plain JSON) |
| Delta patching | `StatePatch.kt` | `StatePatch.swift` | `js/delta.js` |
| Move choreography | `Choreography.kt` | `Choreography.swift` | `js/board.js` |
| Drawn glyphs | `Glyphs.kt` (generated) | `Art.swift` | `js/icons.js` |

`Glyphs.kt` is generated, never hand-edited. The art lives once, in the web
client, and `tools/gen-glyphs.mjs` at the repo root turns it into Kotlin:

```bash
node tools/gen-glyphs.mjs > android/app/src/main/java/com/moneymove/game/Glyphs.kt
```

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

## What is done, and what is not

Done: the design system with all seven table styles in light and dark, the
wire models, delta patching, the socket, the store, the drawn glyph set, the
board with leg-by-leg move choreography, the action panel through every turn
phase, the lobby, the Play tab and Settings.

Not yet: Store (coins, pieces, board rentals), Social (friends, DMs, the
leaderboard), History, trading, the deed sheets, the auction box's own screen,
Google Sign-In, Play Billing, AdMob and push. Those are the next passes.

## Shipping to Google Play — what only you can do

1. **A Play Console account — $25, one time.** <https://play.google.com/console/signup>.
   This is the only purchase Android needs.
2. **A signing keystore.** Play signs releases with a key that must never be
   lost — losing it means never updating the app again. Generate it yourself
   and back it up:

   ```bash
   keytool -genkey -v -keystore moneymove-release.jks \
     -keyalg RSA -keysize 2048 -validity 10000 -alias moneymove
   ```

   Keep the file and its passwords out of this repo (`.gitignore` already
   blocks `*.jks` and `*.keystore`).
3. **Build the release bundle** once the keystore exists — add a
   `signingConfigs` block to `app/build.gradle.kts` reading the passwords from
   environment variables, then `./gradlew bundleRelease`. The AAB is what Play
   wants.
4. **Listing copy** — reuse `APPSTORE.md` at the repo root; Play asks for the
   same things (title, short and full description, screenshots, a privacy
   policy URL, and a data-safety form that matches `public/privacy.html`).

## Notes

- `local.properties` is generated per machine and is gitignored.
- The launcher icon is derived from the iOS app icon so all three platforms
  carry the same mark; the adaptive icon layers live in `res/mipmap-anydpi-v26/`.
