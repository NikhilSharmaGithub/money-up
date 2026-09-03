# Build 4 runbook — fire when Apple answers on v1.0 (build 3)

State to watch: `node data/check-review.mjs` (from the repo root). Today it says
version 1.0 WAITING_FOR_REVIEW, submission 1beaac55-… WAITING_FOR_REVIEW, 3 IAPs waiting.
"Apple answered" = version state is no longer WAITING_FOR_REVIEW / IN_REVIEW
(READY_FOR_SALE, PENDING_DEVELOPER_RELEASE, ACCEPTED → approved; REJECTED /
DEVELOPER_REJECTED / METADATA_REJECTED → rejected). IN_REVIEW alone is not an
answer — keep waiting, but tell Nikhil review has begun.

Key facts: ASC app id 6806881798, v1.0 version id 5f64c974-9214-445f-a602-a0b9b1b3e958,
API key ~/.appstoreconnect/private_keys/AuthKey_93SKS9929V.p8 (Key 93SKS9929V,
Issuer c3ae2bc3-9b35-461b-a365-4d76ed708d07), bundle com.moneymove.game,
helper `data/asc.mjs` (api(), uploadScreenshot()). Simulator UDID for checks:
321D5AB1-669C-4EE3-99C8-482EB8019CD6. Nikhil writes Hinglish; reply in Hinglish.

Build 4 contains (already on main, all verified): circle-flag medallions,
auction seat chips, pass & play seams (chat/leave/concede/deeds/haptics),
dice→token→card choreography, per-board card decks, undealt quick lobby,
report card, Google sign-in — everything since build 3.

## Steps common to both outcomes

1. `cd "/Users/nikhil/Downloads/Monopoly nikhil/ios"` and bump
   `CURRENT_PROJECT_VERSION = 3` → `4` (both spots) in MoneyMove.xcodeproj/project.pbxproj.
2. Archive (Release, generic/platform=iOS, cloud signing with the ASC key flags,
   -allowProvisioningUpdates) to a scratch path; then -exportArchive with
   method app-store-connect, destination upload, manageAppVersionAndBuildNumber false.
   Same commands as build 3 — see git history of this session or scratchpad/upload3.log pattern.
3. Poll `/v1/builds?filter[app]=6806881798&filter[version]=4` until VALID.
4. Commit the pbxproj bump ("Build 4 — …", Co-Authored-By trailer as usual), push.

## If APPROVED (v1.0 live or pending release)

5. The 3 IAPs ride v1.0 — they need no resubmission ever again.
6. Create appStoreVersion 1.1 via API: POST /v1/appStoreVersions
   { versionString: "1.1", platform: "IOS", relationships.app → 6806881798 }.
7. Write release notes (whatsNew) on its en-US localization: short, player-facing —
   round flag medallions, smarter tables, pass & play fixes, new card decks.
8. PATCH 1.1's build relationship → build 4; create reviewSubmission (IOS),
   add the appStoreVersion item, submit (canceled=false path, same flow as before).
9. Tell Nikhil v1.0 is LIVE (congratulate — first release!) and 1.1 is queued.
   If PENDING_DEVELOPER_RELEASE, ask nothing — release it (he wants everything shipped)
   via POST appStoreVersionReleaseRequests, then do the 1.1 flow.

## If REJECTED

5. Fetch the rejection: GET /v1/reviewSubmissions/{id}?include=items, and
   customerReviews/resolutionCenter messages may need the ASC website (his Chrome,
   appstoreconnect.apple.com — App Review page). Read WHY first; report it to
   Nikhil in Hinglish immediately with the exact reasons.
6. Fix what is fixable in code/metadata (do it, verify, commit); anything needing
   his account/identity, hand to him with exact steps.
7. Cancel nothing until the fix is ready. Then: attach build 4 to v1.0
   (PATCH build relationship — the rejected version is editable again),
   re-add the 3 IAPs via his Chrome if they were bounced too
   (In-App Purchases → Edit → select → Add for Review → draft submission),
   and Submit for Review. Same dance as this session did twice.

## Guardrails

- Never pull a WAITING/IN_REVIEW submission for this — only act on a real answer.
- IAP screenshots/metadata are done; do not touch them on the approved path.
- If the archive fails on signing, retry once; then tell Nikhil.
- ADMIN_KEY on prod is the default again by his choice; ads stay dark (ADS_ENABLED unset).

## Ads SDK — where it lives (2026-09-03)

Build 4 ships WITHOUT the Google Mobile Ads SDK. Branch `ads-sdk` holds the
full integration (SPM package ref, ADMOB_APP_ID, GADApplicationIdentifier,
50 SKAdNetworkItems). `RewardedAdNetwork.swift` on main is guarded with
`#if canImport(GoogleMobileAds)`, so with the package absent the offer falls
back to the house ad — verified end to end on the simulator (2 coins in the
ledger, no SDK in the process).

Before build 5 re-links it: redo the App Privacy answers in ASC first
(the SDK's privacy manifest declares an advertising identifier even with
npa=1 and no ATT prompt), then `git merge ads-sdk` into main.
AdMob ids live in data/admob-ids.md.
