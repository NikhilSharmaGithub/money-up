# MoneyMove — App Store submission kit

Everything below is ready to copy-paste into App Store Connect. The only thing
code cannot do for you is enroll in the Apple Developer Program and press the
final Submit button — those need your Apple ID and your payment method.

## What you must do yourself (the only real cost)

1. **Apple Developer Program — $99 USD / year (~₹8,200).**
   Enroll at <https://developer.apple.com/programs/enroll/> with your own
   Apple ID and card. This is the ONLY purchase required to ship the app.
   Everything else (Vercel, Render free tier, GitHub) is already running.
2. After enrollment, open Xcode → Settings → Accounts → sign in with that
   Apple ID. Set the team on the MoneyMove target (Signing & Capabilities).

## One decision before archiving: the bundle ID

The project currently uses `com.moneymove.game`. Bundle IDs are global — if
that one is taken, change it in Xcode (target → Signing & Capabilities) to
something you control, e.g. `com.nikhilsharma.moneymove`, and keep it forever.

## Build & upload (10 minutes, in Xcode)

1. Open `ios/MoneyMove.xcodeproj`, select the *MoneyMove* scheme,
   destination **Any iOS Device (arm64)**.
2. Product → Archive. When the Organizer opens: **Distribute App →
   App Store Connect → Upload** (accept the defaults).
3. In <https://appstoreconnect.apple.com>: My Apps → **+ New App** →
   iOS, name *MoneyMove*, the bundle ID from above, SKU `moneymove-001`.
4. Fill the listing with the copy below, attach screenshots, pick the
   uploaded build, answer the questionnaires (see cheatsheet), Submit for
   Review. First review usually takes 1–3 days.

## Listing copy (paste as-is)

- **Name:** MoneyMove
- **Subtitle:** Property trading with friends
- **Category:** Games → Board (secondary: Casual)
- **Privacy Policy URL:** `https://moneymove-csk9.onrender.com/privacy.html`
- **Support URL:** `https://moneymove-csk9.onrender.com/support.html`
- **Keywords:** `board game,dice,property,trading,multiplayer,friends,pass and play,business,tycoon,estate`
  (never put trademarked game names in keywords — Apple rejects listings for it)
- **Promotional text:** Roll, buy, trade, bankrupt your friends — online or
  pass & play on one device. 25 boards: six continents and 12 country
  editions with their own local card decks.

**Description:**

> MoneyMove is a fast, beautiful property-trading board game for 2–8 players.
>
> ROLL & BUY — walk the board, buy streets, airports and utilities, build
> houses and hotels, and squeeze rent out of everyone who lands on them.
>
> 25 BOARDS — the classic world tour, a giant 48-tile board, quick-fire Blitz,
> chaos on Lucky Wheel, a fresh random board every game, a board for each of
> six continents (Africa, Asia, Europe, North America, South America and
> Oceania — every country with its own flag), and 12 country editions (India,
> USA, UK, Japan and more), each with its own regions, cities and a fully
> local Treasure & Surprise deck.
>
> PLAY TOGETHER — private rooms with a share code, public rooms, teams,
> auctions, trading, and comfortable pass & play: on iPad every player gets
> their own corner of the table.
>
> MAKE IT YOURS — seven table styles with light and dark looks, win coins in
> every victory and spend them on token skins and avatars. Pure style, never
> pay-to-win.
>
> Friends, chat, match history and a game that holds your seat if you
> disconnect. Pull up a chair.

## Review questionnaire cheatsheet

- **Price:** Free. **In-App Purchases:** three consumable coin packs
  (`coins.small` / `.mid` / `.large`), approved and live since 1.0 build 11.
  This line used to say "none" — it was written before the packs existed.
- **App Privacy → Data collection:** the answers below are what the *shipped*
  binary actually does. Anything the app links against declares its own
  collection in a privacy manifest, Xcode folds those manifests into the
  build, and App Store Connect shows you the aggregate — so the label has to
  cover the SDKs too, not just our own code.
  - From the game itself, "not linked to you": Identifiers (a random device
    token), User Content (nickname, chat), Gameplay Content. The phone number
    field never leaves the device — do not list it.
  - From Google Mobile Ads (live since build 11):
    `GoogleMobileAds.framework/PrivacyInfo.xcprivacy` declares Device ID
    **linked** and Tracking = true for Third-Party Advertising, plus Coarse
    Location, Advertising Data, Product Interaction, Performance and Crash
    Data. Answer Apple's "used to track" question the way Google's own
    publisher guidance tells you to for an app that never asks for ATT, and
    make the label match — do not leave it reading "no tracking" while the
    build's privacy report says otherwise.
  - There is **no ATT prompt** and no `NSUserTrackingUsageDescription`, so no
    advertiser id (IDFA) is ever read.
- **Attribution for paid installs:** SKAdNetwork only — `AdSignal.swift` posts
  a conversion value and Apple sends the postback to the ad network. No
  identifier leaves the device and nothing is added to the label by it. Meta's
  own SDK was wired in and removed again; `docs/META-ADS.md` has the evidence
  and what it would take to change that decision.
- **Age rating questionnaire:** everything "None" → lands at 4+ (there is
  simulated property auctioning, not gambling — answer gambling: No).
- **Sign in with Apple:** already implemented ✓ (required because Google
  login exists on web; on iOS only Apple sign-in is offered, which satisfies
  the guideline).
- **Encryption/export compliance:** uses only standard HTTPS → answer
  "standard encryption, exempt".

## Screenshots (take in Simulator, ⌘S saves to Desktop)

Required sizes come from two simulators: iPhone 17 Pro Max (6.9") and
iPad Pro 13". Suggested five shots each:
1. Landing hub with logo + tabs
2. A country board mid-game (Bharat Bazaar looks great)
3. iPad tabletop with corner pods and centre dice
4. The Store tab
5. Game-over screen with the net-worth chart

## Already handled in the repo

- App icon (1024px, asset catalog) ✓
- Launch screen + splash animation ✓
- Production server URL baked in for device builds ✓
- Privacy policy + support pages live on the server ✓
- Version 1.0 (build 1) set in the project ✓
