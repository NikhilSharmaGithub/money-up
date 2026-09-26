# MoneyMove — Google Play submission kit

Everything a Play listing asks for, written out and ready to paste. The build
itself is done: `./gradlew bundleRelease` produces the AAB the moment a
keystore exists, R8 is on, and a minified release has been run end to end on a
device against the live server.

What is left is five console jobs, and every one of them needs your account,
your card, or a file only you can download. They are listed first, in the
order they unblock things.

---

## 1. What only you can do

### a. The Play Console account — $25 USD, once
<https://play.google.com/console/signup>. This is the only purchase Android
needs; the server, the domain and the web app are already paid for. Nothing
below can start until this exists.

### b. The signing keystore — five minutes, and never lose it
Play signs every release with a key that cannot be replaced. Losing it means
never updating the app again.

```bash
keytool -genkey -v -keystore moneymove-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias moneymove
```

Keep it and its passwords out of this repo — `.gitignore` already blocks
`*.jks` and `*.keystore`. The build reads them from the environment:

```bash
MM_KEYSTORE=/absolute/path/moneymove-release.jks \
MM_KEYSTORE_PASSWORD=… MM_KEY_ALIAS=moneymove MM_KEY_PASSWORD=… \
  ./gradlew bundleRelease
```

Unset, the release still builds — unsigned — rather than failing in a way
that looks like a broken build.

### c. Google Sign-In — an Android OAuth client
The code is written and wired; Google refuses to mint a token until this app
is registered in the Cloud project (number **968669711294**) as an Android
OAuth client.

<https://console.cloud.google.com/apis/credentials> → Create credentials →
OAuth client ID → Android

| Field | Value |
| --- | --- |
| Package name | `com.moneymove.game` |
| SHA-1 (debug) | `21:26:1B:59:47:54:DA:23:E9:DF:D4:54:43:11:23:BE:DF:40:A4:DC` |
| SHA-1 (release) | from your keystore — `keytool -list -v -keystore moneymove-release.jks` |
| SHA-1 (Play signing) | Play Console → Setup → App integrity, after the first upload |

All three fingerprints go in. The app asks for a token audienced to the *web*
client id, which is what the server already accepts from the browser and from
iOS — so nothing on the server changes.

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

### e. AdMob — an Android app in the account; push — optional
- **AdMob**: the SDK is in the build now, the same ads the iPhone serves —
  the two rewarded placements and the pre-game interstitial, all npa=1. What
  it is waiting for is an Android app in the AdMob account: Google treats the
  iPhone app and the Android app as two apps with two sets of ids, and will
  not fill an Android request from the iPhone's. `ADMOB-ANDROID.md` is the
  five-minute console walk-through — the app, its three units, the
  verification URL, and where each id goes afterwards.

  Nothing about the wait is a crash or a dead button. The app id comes from
  the `ADMOB_APP_ID` build property, not from source, and a build without a
  well-formed one still launches; the unit ids come from the server's config,
  and a missing one is answered with the house ad. The whole rewarded path —
  offer, ticket, view, server-verified reward, daily caps — stays live and
  carried by the house until the ids arrive, exactly as it is today.

  The store answers change with the first build that carries the SDK, not
  with the day Android starts serving AdMob. That switch is on the admin desk
  and needs no new build, so the form cannot wait for it. See *App content*
  and *Data safety* below.
- **Push**: needs `google-services.json` from Firebase and the
  firebase-messaging dependency. Without them `PushRegistration` is a
  deliberate, quiet no-op.

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
players. Play with friends in a private room, or tap once and land at a table
with whoever else is playing right now. A game runs about half an hour.

TWENTY-FIVE BOARDS
A world tour, a board for each of six continents, single-country boards from
India to Japan, and a few odd ones.
Two different boards are free to everyone every day, and any board can be
rented for a single coin.

PLAY YOUR WAY
Every table sets its own house rules before the dice: starting cash,
auctions, even build, mortgages, double rent on a full country, vacation
payouts, and the shot clock. Quick tables roll their own rules, so two games
in a row are never the same game twice.

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
The same game runs in a browser and on iPhone. A phone, a tablet and a laptop
can sit at one table.

MoneyMove is not affiliated with, endorsed by, or connected to Hasbro or the
MONOPOLY board game.
```

### Category and tags
- **Category**: Games → Board
- **Tags**: board game, multiplayer, property trading, dice, strategy
- **Contains ads**: **Yes** — rewarded videos the player chooses to watch,
  and one interstitial while a quick match is being found. This used to say
  "opt-in only", which stopped being true the day the pre-game break was
  added. Answer Yes from the first build with the SDK in it, even while the
  desk still has Android on house ads.
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
The form covers the Google Mobile Ads SDK as well as the game's own code.
Play counts anything that leaves the phone as collected, whoever's code
sends it, and an SDK compiled in is ours to declare. The row this replaces
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
| Device or other IDs | Collected and shared. Required. Two sources, one row: the game's own random device token, which a wallet hangs on and which goes nowhere but our server (collected, app functionality); and, from the *Ads SDK*, the Android advertising ID and app set ID (collected and shared with Google — advertising or marketing, analytics, fraud prevention/security/compliance). |
| Purchase history | Collected, not shared. Purpose: app functionality. |
| Is data encrypted in transit? | Yes — ours over HTTPS, the SDK's over TLS, per Google's page. |
| Can users request deletion? | Yes — Settings → delete account, and at <https://www.moneymove.live/privacy.html>. The advertising ID is the player's to reset or delete in Android Settings; that control is Google's, and the form asks nothing more of it. |

**The privacy policy has to agree with the form.** `public/privacy.html`
→ *Advertising* still begins "The iOS app includes the Google Mobile Ads
SDK". It must name the Android app too before the first build with the SDK
is submitted — Play reviewers read the policy against these answers.

### URLs
- Privacy policy: `https://www.moneymove.live/privacy.html`
- Support: `https://www.moneymove.live/support.html`
- Website: `https://www.moneymove.live`

### Graphics
- **Screenshots**: `~/Downloads/moneymove-play/screenshots/` — seven 1080×2400
  phone shots taken from the minified release build against the live server.
  Play wants between two and eight; all seven are usable.
- **Feature graphic** (1024×500): not made yet. The OG image at
  `public/og.png` is the right artwork to crop from.
- **App icon** (512×512): export from `android/app/src/main/res/mipmap-*`, or
  re-render from the iOS icon the launcher icon was derived from.

---

## 3. Build and upload

```bash
cd android
MM_KEYSTORE=/absolute/path/moneymove-release.jks \
MM_KEYSTORE_PASSWORD=… MM_KEY_ALIAS=moneymove MM_KEY_PASSWORD=… \
ADMOB_APP_ID=ca-app-pub-1179201999959612~… \
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
  ./gradlew bundleRelease
```

`ADMOB_APP_ID` is the *Android* app's id from AdMob — a tilde in it, not a
slash — and can live in `android/local.properties` instead of the
environment. It is the one ad id baked in at build time; the unit ids come
from the server. Left out, the build still launches and every ad is the
house's, so a release built without it is not broken, only unpaid.

The AAB lands at `app/build/outputs/bundle/release/app-release.aab`. Upload it
to a **Closed testing** track first — Play now requires a period of closed
testing before a new personal developer account can go to production, and
that clock only starts once something is uploaded.

## 4. Version numbers

`versionCode` must rise with every upload and `versionName` is what players
see. Both live in `android/app/build.gradle.kts`. They are independent of the
iOS build numbers — the two stores do not have to agree, and trying to keep
them in step only creates gaps.
