# Buying installs on Meta

What the app sends, what Meta has to be told, and why there is no Facebook SDK
in this binary. Written 21 September 2026, the day after 1.0 went live.

## The short version

Apple's SKAdNetwork carries the whole story. The app posts one number — a rung
on the ladder below — and Apple, not us, sends the postback to whichever ad
network earned the install. Meta learns "a campaign produced an install that
reached step 5". It never learns who, and nothing identifying leaves the phone.

So there is no ATT prompt, nothing to add to the App Privacy label, and nothing
in the build a reviewer can catch us on.

## The ladder (AdSignal.swift)

The value only ever goes up, and each rung is worth strictly more to us than
the one below it. Apple allows 0...63 for the fine value; we use 0...7.

| Value | Step | What happened |
|---|---|---|
| 0 | installed | First launch. Registers the install — without this there is no postback at all. |
| 1 | played | Dealt into a game, alone with the bots. |
| 2 | playedWithPeople | Dealt in with at least one other person at the table. |
| 3 | won | First win. A stranger became a player. |
| 4 | boughtSmallPack | Bought the small coin pack. |
| 5 | boughtMidPack | Bought the mid pack. |
| 6 | boughtLargePack | Bought the large pack. |
| 7 | boughtAgain | A second pack, whichever packs they were. |

Coarse value, which is what Meta receives when an install is one of too few to
report precisely: 0-2 low, 3 medium, 4-7 high.

## What to configure in Meta

Events Manager → the MoneyMove data source → **Apple's SKAdNetwork →
Configure events**. The schema there must read the same way as the table above,
most valuable first, or the campaign optimises towards the wrong number:

1. Purchase (values 4-7)
2. Achievement unlocked / first win (3)
3. Game started with other people (2)
4. Game started (1)
5. App install (0)

Meta re-verifies a changed schema and it takes about 72 hours to reach live
campaigns, so set it before the first campaign, not during one.

## Why there is no Facebook SDK

It was wired in first — FacebookCore via SPM, an app id and client token in
Info.plist, events for purchase, game-started and first-win — and then taken
out again on evidence:

1. **The SDK declares tracking, for an app that does not track.** FacebookCore
   ships a `PrivacyInfo.xcprivacy` with `NSPrivacyTracking = true` and a Device
   ID marked linked, tracked, and used for third-party advertising. Xcode folds
   that manifest into the build's privacy report and merges its
   `NSPrivacyTrackingDomains` (ep1.facebook.com) into the app's Info.plist. App
   Store Connect then shows a build that says it tracks, while the declared
   label says it does not and no ATT prompt exists. That is a 5.1.2(i)
   rejection, and it lands whether or not the SDK is configured.
2. **Nothing would arrive anyway.** iOS blocks requests to a declared tracking
   domain until App Tracking Transparency has been granted. With no prompt,
   permission is never granted, the SDK's events never reach ep1.facebook.com,
   and the tracking declaration is paid for with nothing bought.

Taking the SDK route means showing an ATT prompt in a 4+ board game and telling
players the app tracks them. That is a decision about what the app says to its
players, not a technical detail, so it is the owner's to make. If it is ever
made: add `NSUserTrackingUsageDescription`, ask with
`ATTrackingManager.requestTrackingAuthorization` before the SDK's first event,
re-answer the App Privacy questions, and expect the review to look harder at a
game rated 4+.

## What SKAdNetwork costs us in exchange

- Postbacks arrive 24-48 hours late, in windows, not in real time.
- Below Apple's privacy threshold the fine value is withheld and only the
  coarse one survives — so early, small campaigns report less than they earned.
- No lookalikes, no retargeting, no per-user reporting. Country, language and
  the creative are the whole of the targeting (Advantage+ app campaigns are the
  only iOS option Meta offers now).

That is the trade: less measurement, no tracking declaration, no prompt.
