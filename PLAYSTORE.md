# MoneyMove — Google Play submission kit

Everything a Play listing asks for, written out and ready to paste. The build
itself is done: `android/release.sh` makes the upload key if there is none,
builds the signed AAB and copies it to `~/Downloads/moneymove-play/`. R8 is on,
and a minified release has been run end to end on a device against the live
server. The version going up first is **1.0.3** (versionCode 1).

What is left is five console jobs, and every one of them needs your account,
your card, or a file only you can download. They are listed first, in the
order they unblock things.

---

## 1. What only you can do

### a. The Play Console account — $25 USD, once
<https://play.google.com/console/signup>. This is the only purchase Android
needs; the server, the domain and the web app are already paid for. Nothing
below can start until this exists.

### b. The upload key and the build — one command, and never lose the key
In your own Terminal:

```bash
cd ~/"Downloads/Monopoly nikhil/android" && ./release.sh
```

The first run makes `~/moneymove-keys/moneymove-release.jks` (alias
`moneymove`, RSA 2048, valid 10,000 days). keytool asks for the password and
the name fields itself; the script never sees them. It then asks for the
password once, hidden, hands it only to the Gradle build, and wipes it when it
finishes. It refuses to build without `android/app/google-services.json`
(push would be silently off), checks the bundle is signed, carries
`AD_ID` and a real AdMob app id, copies it to
`~/Downloads/moneymove-play/app-release.aab`, and prints the key's SHA-1 and
SHA-256. Those two are public fingerprints: they go into *c* below.

**Back up `~/moneymove-keys` and the password the day it is made.** This is
the *upload* key. Google holds the app signing key under Play App Signing, so
a lost upload key is not quite the end of the app, but getting a new one
registered is a support request and days of waiting with no updates. Treat
losing it as never updating the app again. It lives outside the repo, and
`.gitignore` blocks `*.jks` and `*.keystore` anyway.

Built by hand, the variables are the ones `build.gradle.kts` reads (see
section 3). Unset, the release still builds, unsigned, rather than failing in
a way that looks like a broken build; `release.sh` catches that.

### c. Google Sign-In — two more Android OAuth clients
Google mints a sign-in token only for a package *and* signing certificate it
has been told about, and an Android OAuth client holds exactly one SHA-1. The
first one exists: **"MoneyMove Android (debug)"**, in the Cloud project
`gen-lang-client-0491634890` (number **968669711294**, the one the web and
iOS clients live in), which is why sign-in works on debug builds today.
Release builds carry different certificates, so two more clients are needed,
same project, same package:

<https://console.cloud.google.com/apis/credentials> → Create credentials →
OAuth client ID → Android

| Client | Package name | SHA-1 | Status |
| --- | --- | --- | --- |
| MoneyMove Android (debug) | `com.moneymove.game` | `21:26:1B:59:47:54:DA:23:E9:DF:D4:54:43:11:23:BE:DF:40:A4:DC` | Done |
| MoneyMove Android (upload) | `com.moneymove.game` | printed by `release.sh` at the end of a build | To add |
| MoneyMove Android (Play) | `com.moneymove.game` | Play Console → App integrity → App signing → *App signing key certificate* (type "App signing" in the console's search), after the first upload | To add |

The Play one is the one that matters most: every copy installed from the
store is signed with Google's key, not the upload key, so without it sign-in
fails for every player while working on every test build. The app asks for a
token audienced to the *web* client id, which is what the server already
accepts from the browser and from iOS, so nothing on the server changes.

### d. Play Billing — products, and a way to check a purchase
Two halves, and the app is blocked on neither but the money is blocked on both.

**In the Play Console**, create three managed products with exactly these ids
(they are Apple's ids too, so one `packByProductId()` in `server/store.js`
answers for both stores):

| Product ID | Coins | Suggested price |
| --- | --- | --- |
| `com.moneymove.game.coins.small` | 500 | $4.99 |
| `com.moneymove.game.coins.mid` | 1,100 | $9.99 |
| `com.moneymove.game.coins.large` | 2,500 | $19.99 |

**On the server**, a service account so purchases can be verified. In the
Cloud project the Play Console is linked to: enable the **Android Publisher
API**, create a service account, give it *View financial data* on the app in
Play Console → Users and permissions, download its JSON key, and put it on
Render as the secret file `/etc/secrets/play-service-account.json` (or the
`PLAY_SERVICE_ACCOUNT` env var).

Until that lands, `/api/store/redeem/play` refuses every purchase and says so
in those words — a verifier that cannot verify must never say yes. The boot
log tells you which of the two states the server is in.

### e. AdMob — link the store listing; push — already live
- **AdMob**: done except for one link. The Android app exists in AdMob
  (`ca-app-pub-1179201999959612~9068269365`, in `android/gradle.properties`
  as `ADMOB_APP_ID`), with its three units (Free coins and Double win
  rewarded, the Pre-game interstitial) served from `server/ads.js`, all
  npa=1, and Android already serves real AdMob ads. AdMob marks the app
  *Requires review / Limited ad serving* until it is tied to a store listing:
  once the Play listing is live, AdMob → Apps → MoneyMove (Android) → App
  settings → *Add app store* and pick it. `ADMOB-ANDROID.md` has the rest of
  the walk-through.

  The store answers below describe the build, which carries the SDK, not the
  admin desk's switch, which needs no new build. See *App content* and *Data
  safety* below.
- **Push**: live through Firebase Cloud Messaging and verified against
  production (a turn push arrived, and tapping it opened the table). The
  server's service account is on Render as `firebase-sa.json`;
  `android/app/google-services.json` is on this Mac only, because the repo is
  public. A build without that file is a quiet no-op for push, which is
  exactly why `release.sh` refuses to build without it.

---

## 2. The listing

### App name (30 chars)
```
MoneyMove
```

### Short description (80 chars)
```
Buy streets, build hotels, bankrupt your friends. Online property board game.
```

### Full description (4000 chars)
```
Roll, buy, build, and bankrupt everyone at the table.

MoneyMove is a fast online property trading board game for two to eight
players. Play with friends in a private room, or tap Play now: a lobby fills
with whoever else is playing right now, and the host starts the game once the
table is ready. A game runs about half an hour.

TWENTY-FIVE BOARDS
A world tour, a board for each of six continents, single-country boards from
India to Japan, and a few odd ones.
Two different boards are free to everyone every day, and any board can be
rented for a single coin.

PLAY YOUR WAY
Every table sets its own house rules before the dice: starting cash,
auctions, even build, mortgages, double rent on a full country, vacation
payouts, and the shot clock. Play-now tables roll their own rules, and the
host can change them, the starting cash and the board in the lobby, where
everyone sees what changed. Two games in a row are never the same game twice.

REAL OPPONENTS, OR HOUSE PLAYERS
Short a player? The house sits in, trades with the other bots, talks in the
chat, and plays to win. Nobody waits on an empty chair.

NOBODY WAITS
Ninety seconds a turn. Miss one and the house plays that single turn for you —
you keep your streets, your money and your seat. Only a second missed turn in
a row gives the chair away.

COINS ARE STYLE, NEVER ADVANTAGE
Win games and collect a daily reward. Spend coins on a piece to push round the
board, a face for your chip, or a board to play on. Never on a better
position, a bigger bank, or a luckier roll. Everything you can buy is
something other people can see and nothing you can win with.

TALK AT THE TABLE
Every table has a chat, and the house players answer. Any message can be
reported or its author blocked, from the line itself.

ONE GAME, THREE SCREENS
The same game runs in a browser, on iPhone and on Android. A phone, a tablet
and a laptop can sit at one table.

MoneyMove is an original game and is not affiliated with or endorsed by any
board game publisher.
```

The last line used to name Hasbro and MONOPOLY. A trademark named in a
listing, even inside a disclaimer, is exactly what Play's intellectual
property and metadata checks look for, and a keyword match is enough to hold
a review, so the listing names nobody. The privacy page names nobody either.

### Category and tags
- **Category**: Games → Board
- **Tags**: board game, multiplayer, property trading, dice, strategy
- **Contains ads**: **Yes** — rewarded videos the player chooses to watch,
  and a full-screen interstitial before every new table the player opens by
  their own tap: Play now, a new private game, a code, a public room, an
  invite, a friend's table, a quick Play again. Never before a cup match, a
  rematch, a game being resumed, or one opened from a push, and never more
  often than the gap set on the admin desk. It shows at the tap and never
  delays the table. This used to say "opt-in only", and before that "while a
  quick match is being found"; neither is true now.
- **In-app purchases**: yes — $4.99 to $19.99 per item

### Content rating questionnaire — the answers
- Violence: none
- Sexuality: none
- Language: none
- Controlled substances: none
- **Users can interact**: YES — this is the one that matters. Say yes.
- **Users can share content**: yes, text chat and direct messages
- **Users can share location**: no
- **Digital purchases**: yes
- Expected rating: **PEGI 3 / ESRB Everyone**, with an "interactive elements:
  users interact, digital purchases" note.

### App content → Advertising ID
`play-services-ads` declares `com.google.android.gms.permission.AD_ID` in
its own library manifest, and Gradle merges it into ours without a line of
our code asking for it. The app targets SDK 36, where an app without that
permission reads the advertising ID as a string of zeros; with it, the SDK
reads the real one. npa=1 does not change that — it governs what an ad is
chosen by, not what the SDK sends — so this is not the iPhone's situation,
where no ATT prompt means a zeroed id.

The declaration, then:

- **Does your app use advertising ID?** Yes
- **Purposes**: Advertising or marketing · Analytics · Fraud prevention,
  security, and compliance — the three Google gives for the SDK. Not
  *Personalization*: every request is npa=1.

A "No" while the bundle carries the permission is refused at upload, and
the permission arrives by merge, so check the bundle rather than the source:

```bash
unzip -p app/build/outputs/bundle/release/app-release.aab base/manifest/AndroidManifest.xml \
  | grep -a -c 'permission.AD_ID'
```

Anything above 0: answer as above. 0 means someone has removed it with
`tools:node="remove"` — the Android cousin of never asking for ATT — and then
the answer is No, and the advertising ID comes out of the *Device or other
IDs* row below. The app set ID stays in it either way.

### App content → Target audience and content
- **Age groups**: 13–15, 16–17, 18 and over. No band under 13. The game is
  not made for children and does not say it is: strangers talk at every
  table, coins are sold, and ads are served. Ticking any under-13 band puts
  the app under the Families policy, which wants every ad request
  child-directed — a Families-certified setup, child-directed treatment on,
  no advertising ID — and this build does none of that, rightly, for an app
  that is not for children.
- **Could the store listing unintentionally appeal to children?** No.
- **Ads must fit the audience**, and that is set in AdMob, not Play: AdMob →
  Blocking controls → maximum ad content rating **T**. Set on *All apps* it
  covers the iPhone too, which is the point — one game, one ceiling.

### Data safety form
The form covers the Google Mobile Ads SDK and Firebase Cloud Messaging as
well as the game's own code. Play counts anything that leaves the phone as
collected, whoever's code sends it, and an SDK compiled in is ours to
declare. The row this replaces
said "only once AdMob is switched on"; that was right while the SDK was not
in the binary and is wrong now, because the switch is server-side and the
form has to describe the build.

Google's disclosure page for the SDK
(<https://developers.google.com/admob/android/privacy/play-data-disclosure>,
checked September 2026 — the Next-Gen SDK's page lists the same four) says
it "collects and shares" four things automatically, for advertising,
analytics and fraud prevention: the IP address, product interactions,
diagnostics, and device identifiers. The rows marked *(Ads SDK)* are those.

**Collected *and* shared, and why both.** Collected because it leaves the
phone. Shared because it goes to Google as a third party that uses it for
its own network's measurement and fraud prevention — that is not the
"service provider acting only on our behalf" exemption, and Google's own
page says *shares*. npa=1 changes what Google may do with it, so never tick
*Personalization*; it does not change whether it is sent.

**Required, not optional.** The rewarded ads are opt-in; the pre-game
interstitial is not. A player cannot keep the SDK quiet by never tapping an
offer, so the SDK rows say *required*.

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | Yes |
| Location — approximate location *(Ads SDK)* | Collected and shared. Required. Purposes: advertising or marketing, analytics, fraud prevention/security/compliance. The game never asks for location. This is Google estimating a general area from the IP address, which is how its page describes it, and a city-sized estimate is what Play's *approximate* means. |
| Personal info — name | Collected, not shared. Optional. A nickname the player types; it is never taken from a Google account. Purpose: app functionality. |
| Personal info — email | Collected, not shared. Optional, only if the player signs in with Google. Purpose: account management. |
| Photos | Collected, not shared. Optional — the Google profile picture, shown only to its owner. |
| Messages — in-app | Collected, not shared. Chat and direct messages. Purpose: app functionality. |
| App activity — app interactions *(Ads SDK)* | Collected and shared. Required. Advertising or marketing, analytics, fraud prevention/security/compliance. Launches, taps and video views, as Google lists them. |
| App info and performance — diagnostics *(Ads SDK)* | Collected and shared. Required. Advertising or marketing, analytics, fraud prevention/security/compliance. Launch time, hang rate, energy use. The game itself sends no crash reports. |
| Device or other IDs | Collected and shared. Required. Three sources, one row: the game's own random device token, which a wallet hangs on and which goes nowhere but our server (collected, app functionality); the **FCM registration token** (and the Firebase installation ID it is issued against), which the Firebase library fetches from Google at launch and the app sends to our server once the player allows notifications, so a turn, an invite or a cup can reach the phone (collected, not shared: Google handles it as Firebase, our processor; app functionality); and, from the *Ads SDK*, the Android advertising ID and app set ID (collected and shared with Google — advertising or marketing, analytics, fraud prevention/security/compliance). |
| Purchase history | Collected, not shared. Purpose: app functionality. |
| Is data encrypted in transit? | Yes — ours over HTTPS, the Ads SDK's over TLS and Firebase's over HTTPS, per Google's pages. |
| Can users request deletion? | Yes — Settings → Account & help → Delete account (which also drops the phone's FCM token), and at <https://www.moneymove.live/privacy#delete-account>. The advertising ID is the player's to reset or delete in Android Settings; that control is Google's, and the form asks nothing more of it. |
| Delete account URL (the form's *Account deletion* step) | `https://www.moneymove.live/privacy#delete-account`. Play wants a web page, reachable without the app, that names the app, gives the steps, and says what is deleted and what is kept; that section does all four, and the email route works for someone who has uninstalled. |

**The privacy policy has to agree with the form**, because Play reviewers
read one against the other. As of 26 September 2026 it does:
`public/privacy.html` → *Advertising* names the iOS and the Android app as
carrying the Google Mobile Ads SDK, and the Android advertising ID;
*Notifications* says Android push is a Firebase Cloud Messaging token sent to
our server and to Google; *Coin purchases* names Google Play. It also says
what the form's *(Ads SDK)* rows say: Google may estimate a general area from
the IP address, and gets basic diagnostics. Its old line "No collection of ...
photos" is gone, because the form declares the Google profile photo; it now
says the app never touches the camera or the photo library, and that the Google
photo is the only picture kept. The deletion heading carries the
`#delete-account` anchor the form's URL points at. The page is on Vercel, so it
is live once that change is pushed; check the live URL says "Last updated: 26
September 2026" before submitting.

### URLs
- Privacy policy: `https://www.moneymove.live/privacy`
- Support: `https://www.moneymove.live/support`
- Website: `https://www.moneymove.live`

Vercel serves these without `.html` (`cleanUrls`); the `.html` forms answer
with a 308 redirect to them, so give Play the short ones.

### Graphics
All in `~/Downloads/moneymove-play/`, checked against Play's asset rules on
26 September 2026.

- **Phone screenshots: upload `screenshots-play/1-board.png` to
  `6-styles.png`, in that order.** Six shots, 1080×1920 (9:16), 24-bit PNG,
  no alpha, each about 1 MB. The emulator captures in `screenshots/` are
  1080×2400, and Play refuses those: a screenshot's long side may be at most
  twice its short side, and 2400/1080 is 2.22. 1080×1920 also meets the size
  Play asks of a game (three or more 9:16 shots of at least 1080×1920) before
  it will feature it in its large-format game rows.
  Each shot sits on the felt of the feature graphic under a two-line caption
  that takes 15% of the image (Play's ceiling is 20%). None has a call to
  action, a price, a ranking or anything that dates, and none has a device
  frame; Play asks for all of that. The app's own pixels are untouched: the
  gesture bar is cropped off, and the two board shots lose part of the empty
  lavender band between the board and the player strip, which is what the
  table looks like on a 16:9 phone anyway. `screenshots-play/plain/` has the
  same six without captions if you prefer those. `screenshots-play/source/make.py`
  rebuilds both sets from `screenshots/`.
  Left out: `7-store.png` (every skin is greyed out because the capture
  account had 7 coins, so the store looks broken) and `6-boards.png` (the
  sheet's coin pill and Done button sit under the status bar clock and
  battery, a real bug). Retake both once that inset is fixed and the account
  can afford a skin. `screenshots-old/` is the pre-glass UI; do not use it.
- **Feature graphic**: `graphics/feature-graphic.png`, 1024×500, 24-bit, no
  alpha (the felt version; `feature-graphic-crimson.png` is the alternative).
- **App icon**: `graphics/icon-512.png`, 512×512, 32-bit PNG, fully opaque,
  a full square with no rounded corners or shadow of its own; Play adds
  those.

---

## 3. Build and upload

```bash
cd ~/"Downloads/Monopoly nikhil/android" && ./release.sh
```

That is the whole build (section 1b says what it does). It prints where the
AAB is, copies it to `~/Downloads/moneymove-play/app-release.aab`, prints the
upload key's SHA-1 and SHA-256, and says whether `AD_ID` is in the bundle.

By hand, if the script is ever in the way, the same thing is:

```bash
cd android
MM_KEYSTORE="$HOME/moneymove-keys/moneymove-release.jks" \
MM_KEYSTORE_PASSWORD=… MM_KEY_ALIAS=moneymove MM_KEY_PASSWORD=… \
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
  ./gradlew --no-daemon -Pkotlin.compiler.execution.strategy=out-of-process bundleRelease
```

The Kotlin flag stops the build leaving a Kotlin compile daemon behind that
would hold the password in its environment for a couple of hours; it prints
compiler warnings with an "exception:" prefix, which are still only warnings.

Android Studio is not on this Mac at the moment; `release.sh` falls back to
`$HOME/.antigravity/extensions/redhat.java-1.52.0-darwin-arm64/jre/21.0.9-macosx-aarch64`,
and so should a hand-built JAVA_HOME. Typing the password into a command line
leaves it in the shell history, which is one more reason to use the script.

`ADMOB_APP_ID` is the *Android* app's id from AdMob — a tilde in it, not a
slash — and is already in `android/gradle.properties`
(`ca-app-pub-1179201999959612~9068269365`). It is the one ad id baked in at
build time; the unit ids come from the server. Left out, the build still
launches and every ad is a test ad or the house's, so a release built without
it is not broken, only unpaid; `release.sh` warns if that happens.

The AAB lands at `app/build/outputs/bundle/release/app-release.aab`. Upload it
to a **Closed testing** track first. A personal developer account made after
13 November 2023 can apply for production only after a closed test with at
least **12 testers opted in for the 14 days in a row before you apply**; a
tester who opts out and back in restarts their own count. The application
then asks how they tested, what you changed because of it, and who the game
is for. So the clock really starts when the twelfth tester opts in, not at
the upload: line up twelve Gmail addresses (friends who will play a game or
two that fortnight) before creating the track. An organisation account (it
needs a D-U-N-S number) skips this.

### Release notes for 1.0.3 (Play)
Paste into *Release notes* when creating the release (437 of 500 characters).

```
<en-US>
MoneyMove arrives on Android.
• Play now opens a lobby: the host starts the game, everyone else taps Ready, and the host can change the rules first
• 25 boards, including one for each of six continents
• A new glass look on every button and sheet
• Notifications for your turn, invites and cups
• Sign in with Google, coin packs, tournaments, chat and friends
• Money moves when your piece lands, with new win, bankrupt and launch sounds
</en-US>
```

## 4. Version numbers

`versionCode` must rise with every upload and `versionName` is what players
see. Both live in `android/app/build.gradle.kts`. They are independent of the
iOS build numbers — the two stores do not have to agree, and trying to keep
them in step only creates gaps.

The first upload is **versionName 1.0.3, versionCode 1**. 1.0.3 matches what
the iPhone is on, so the two stores describe the same game; versionCode starts
at 1 because this is Play's first build. The next upload to any track, even a
rebuild of the same 1.0.3, needs versionCode 2: Play refuses a code it has
already seen, including one from a release that was never rolled out.
