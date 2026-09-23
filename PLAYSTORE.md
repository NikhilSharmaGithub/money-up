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

### e. AdMob and push — optional, and deliberately absent
- **AdMob**: create the Android app in AdMob, then add its `APPLICATION_ID`
  to the manifest and `com.google.android.gms:play-services-ads` to
  `app/build.gradle.kts`. There is no SDK in this build on purpose: it does
  not warn without an app id, it crashes the app on launch. Meanwhile the
  whole rewarded path — offer, ticket, view, server-verified reward, daily
  caps — is live and carried by the house ad.
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

NINETEEN BOARDS
A world tour, single-country boards from India to Japan, and a few odd ones.
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
- **Contains ads**: yes (rewarded, opt-in only)
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

### Data safety form
| Question | Answer |
| --- | --- |
| Does your app collect or share user data? | Yes |
| Personal info — name | Collected, not shared. Optional. A nickname the player types; it is never taken from a Google account. Purpose: app functionality. |
| Personal info — email | Collected, not shared. Optional, only if the player signs in with Google. Purpose: account management. |
| Photos | Collected, not shared. Optional — the Google profile picture, shown only to its owner. |
| Messages — in-app | Collected, not shared. Chat and direct messages. Purpose: app functionality. |
| Device or other IDs | Collected, shared with ad partners. Purpose: advertising. **Only once AdMob is switched on** — while ads are house-served, nothing is shared, and the form must say what is true at the time you submit it. |
| Purchase history | Collected, not shared. Purpose: app functionality. |
| Is data encrypted in transit? | Yes |
| Can users request deletion? | Yes — Settings → delete account, and at <https://www.moneymove.live/privacy.html> |

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
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
  ./gradlew bundleRelease
```

The AAB lands at `app/build/outputs/bundle/release/app-release.aab`. Upload it
to a **Closed testing** track first — Play now requires a period of closed
testing before a new personal developer account can go to production, and
that clock only starts once something is uploaded.

## 4. Version numbers

`versionCode` must rise with every upload and `versionName` is what players
see. Both live in `android/app/build.gradle.kts`. They are independent of the
iOS build numbers — the two stores do not have to agree, and trying to keep
them in step only creates gaps.
