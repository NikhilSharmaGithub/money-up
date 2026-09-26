# AdMob for Android — the console half

The Android build carries Google's SDK and serves the same ads as the
iPhone: two rewarded placements and one pre-game interstitial, all npa=1. It
is waiting on three things only you can make — an Android app in AdMob, its
three ad units, and the ids pasted where the build and the server read them.
Until then every Android ad is the house promo; nothing crashes and no
button goes dead for want of an id.

Five minutes, in this order, all in the same AdMob account as the iPhone
app (publisher `pub-1179201999959612`). The steps are written so that you can
also hand the browser to an agent.

---

## 1. Add the app

<https://apps.admob.com> → **Apps** → **Add app**

1. Platform: **Android**.
2. *Is the app published on a supported app store?* — **No**. It is not on
   Play yet; step 5 links it once it is.
3. App name: **MoneyMove**. Leave the rest as it is → **Add app**.
4. Copy the **App ID**: `ca-app-pub-1179201999959612~…` — a *tilde* in it.

The iPhone's app id will not do. AdMob treats the two as two different apps,
and an Android request under the iPhone's id is not filled.

## 2. Make the three ad units

In the new app → **Ad units** → **Add ad unit**. The same three the iPhone
has, one per server slot:

| Name it | Format | Server slot | Desk field (Android) |
| --- | --- | --- | --- |
| Double win (Android) | **Rewarded** | `doubleWin` | Double-win rewarded unit |
| Free coins (Android) | **Rewarded** | `freeCoins` | Free-coins rewarded unit |
| Pre-game (Android) | **Interstitial** | `preGame` | Pre-game INTERSTITIAL unit |

- **Rewarded** means *Rewarded*, not *Rewarded interstitial*. That is a
  different format and the app's loader will not fill from it.
- The reward the form asks for: amount `1`, item `coins`. The app ignores it —
  what a view pays is the server's ticket (a double-up pays the win again,
  free coins pays 2) — so it is never the number to change.
- The interstitial: leave both ad types ticked and AdMob's frequency cap off.
  The desk's *Pre-game gap (min)* is the cap, and two caps only fight.
- Copy each unit id: `ca-app-pub-1179201999959612/…` — a *slash* this time.

### Server-side verification — both rewarded units, not the interstitial

Without it the server never hears that a view finished, and every Android
claim answers "not confirmed yet" for ever.

Open each rewarded unit → **Advanced settings** → **Server-side
verification** → *Callback URL*:

```
https://moneymove-csk9.onrender.com/api/ads/ssv
```

→ **Verify URL** → **Use verified URL** → **Save**.

- Exactly that host. `www.moneymove.live` is the static site and answers
  this path with a 404, so the verify fails there.
- No query string. Google appends its own, and the server reads the ticket
  out of `custom_data` and `user_id`.
- The verify ping carries no ticket, so the desk's Ads → Verification panel
  counts one rejected callback. That one is expected.

## 3. Put the ids where they are read

**App ID → the Android build.** It is baked into the manifest, so it is the
only id that needs a new build:

```properties
# android/local.properties — per machine, already git-ignored
ADMOB_APP_ID=ca-app-pub-1179201999959612~XXXXXXXXXX
```

or `ADMOB_APP_ID=…` in the environment of whatever runs
`./gradlew bundleRelease` (the CI job, or the command in `PLAYSTORE.md` §3).
A build without it, or with anything that is not `ca-app-pub-…~…`, still
launches and shows the house ad.

**Unit ids → the admin desk.**
<https://moneymove-csk9.onrender.com/admin> → **Ads** → the **Android**
AdMob fields, beside the iPhone's: the Android App ID again (the server uses
it to decide Android is configured), then the two rewarded units and the
interstitial, as in the table above → **Save**. Android picks them up on its
next config read — no build, no deploy. A field left empty keeps Android on
the house ad and does not touch the iPhone.

**Do not use the desk's Test mode to try this.** It is one switch for every
client: flipping it puts the iPhone on Google's test ids too, which stops
real revenue and pays rewards unverified. Try Android on an emulator or a
debug build instead.

**Check it landed.** After the first real Android view, Ads → Verification
shows a confirmation naming the Android unit, and the server log says
`ads: SSV confirmed … on android`.

## 4. Once the app is on Play: link it

AdMob keeps an app that is not linked to a store on **limited ad serving** —
ads fill, but thinly — and does not start its readiness review until it is
linked. Android earnings will look poor until this step, and that is not a
bug.

When MoneyMove is publicly listed on Google Play (a closed-testing app is
invisible to AdMob's search):

AdMob → **Apps** → **View all apps** → MoneyMove (Android) → **App settings**
→ **App store details** → **Add** → search Google Play for
`com.moneymove.game` → select it → **Add**. The review starts by itself.

## 5. app-ads.txt — already done

AdMob reads it from the *Website* on the Play listing
(`https://www.moneymove.live`, as `PLAYSTORE.md` has it). The site and the
server both already serve:

```
google.com, pub-1179201999959612, DIRECT, f08c47fec0942fa0
```

That is the publisher of the whole account, so it vouches for the Android
app exactly as it does for the iPhone one — nothing to add. Its status shows
under AdMob → **Apps** → **app-ads.txt** a day or so after linking. It would
only need a second line if the Android app lived in a different AdMob
account.

---

> **Never tap a live ad on your own phone.** Debug builds and emulators are
> treated as test devices; a release build on your own phone is not, and
> clicks on your own live ads are how AdMob accounts get suspended. To look
> at a release build safely, add the phone under AdMob → Settings → Test
> devices first.
