# AdMob — MoneyMove (created 2026-09-03)

Publisher: ca-app-pub-1179201999959612
These are not secrets: an app's AdMob ids ship inside the binary.

| What | Id |
|---|---|
| iOS app (GADApplicationIdentifier) | `ca-app-pub-1179201999959612~5259376124` |
| Rewarded — Double win | `ca-app-pub-1179201999959612/6601367639` |
| Rewarded — Free coins | `ca-app-pub-1179201999959612/2662122626` |

Server-side verification is set on BOTH units and Google verified it live:
`https://moneymove-csk9.onrender.com/api/ads/ssv`

State on the day they were made: the AdMob account is "being verified"
(up to two weeks) and the app shows "Requires review" because it is not on
the App Store yet. Neither blocks development — Google's official test unit
`ca-app-pub-3940256099942544/1712485313` serves real test ads immediately.
Real fill starts once the account is approved and the app is live and linked.

Still to do when ads go live:
- Link the AdMob app to the App Store listing (Apps → MoneyMove → App settings)
- Paste these ids into the admin desk's ads card, set provider to admob, flip it on
- Web needs AdSense (separate account + site approval) — AdMob does not serve browsers
