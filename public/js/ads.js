// The web's rewarded ad — and the reason the house ad never goes away.
//
// AdMob does not serve browsers. What Google points a browser game at is
// AdSense H5 Games Ads, and its whole API is one script and one queue: push an
// `adConfig` object onto `window.adsbygoogle` to describe the game, push an
// `adBreak` object onto the same array to ask for a break. A break of type
// 'reward' answers with `adViewed` or `adDismissed`, and always with
// `adBreakDone`. That is the entire surface, and this file is all of it.
//
// Two rules run the file.
//
// The first is that a dark game ships no third-party script at all. Nothing
// here reaches Google until the server has said, in one breath, that ads are
// on, that the provider is 'h5', and what the publisher id is. There is no id
// until the owner has an approved AdSense account, so until that day this
// module loads nothing, contacts nobody, and the house ad is still the whole
// system — which is exactly what shipped yesterday.
//
// The second is that this file cannot pay anybody. It answers one question —
// did Google play an ad all the way through — and hands the answer back to
// ui.js, which redeems the ticket the server issued. A blocked script, a
// no-fill, a browser extension or a Google outage all come back 'unavailable',
// and the house ad runs instead: nobody bought the slot is not the player's
// problem, and they were promised a reward for a break. Enough people run a
// blocker that this is not the sad path. It is the ordinary one, and it has to
// feel like the ordinary one.

import { isEnabled as soundOn } from './sound.js';

const SCRIPT_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

// The publisher id is about to be interpolated into a script URL, so it is
// checked against the only shape AdSense issues rather than trusted. A typo in
// the admin box should leave the house ad serving, not point a <script> tag at
// somewhere nobody meant.
const CLIENT_RE = /^ca-pub-\d{10,24}$/;

/**
 * Whether this page is really a page, or an app wearing one.
 *
 * H5 Games Ads is AdSense inventory, and AdSense is for the web: Google does
 * not allow it inside an app that wraps a page in a WebView, and points
 * publishers at AdMob for that. The Android build is exactly such a wrapper —
 * it loads this same file from the same origin Chrome does, and it has no way
 * of knowing it is not Chrome, which is the trap. The tag would load in there
 * and ads would serve, and nobody would find out until the AdSense account
 * went with them, taking the real browser's ads too.
 *
 * "; wv" is the WebView's own mark in the User-Agent, and Chrome for Android
 * never carries it. The server refuses the same surface from its side; this is
 * the half that holds even if an older server, or one configured by hand,
 * answers 'h5' to a client that must not have it.
 */
const inAppWebView = () => /;\s*wv[);]/i.test(navigator.userAgent || '');

// How long the SDK gets to answer `onReady` before this device is written off.
// It is spent in the background at boot, not in front of anybody.
const READY_MS = 4000;
// How long a break gets to produce an ad before the house takes it. This one
// IS in front of a player, mid-press, watching a button say "Loading the ad…",
// so it is as short as a slow phone can bear.
const START_MS = 5000;
// And once Google has the screen, how long before we decide it is never giving
// it back. No rewarded ad runs three minutes; at that point something is
// broken, and the player is better off with five seconds of house than with a
// button that never comes back.
const STUCK_MS = 180000;

// Stable names, because they are what the owner will see broken out by
// placement in his AdSense reports.
const BREAK_NAMES = { doubleWin: 'double-win', freeCoins: 'free-coins' };

const state = {
  loading: false,   // the script tag exists — true at most once per page
  ready: false,     // adConfig's onReady fired: the SDK is really running
  dead: false,      // blocked, refused, or never answered — house from here on
  busy: false,      // a break is open; the SDK serves exactly one at a time
};
// Resolves true when the SDK checked in, false when it plainly didn't. Held so
// the first press can wait out whatever is left of the window instead of
// falling through to the house while the script is still in flight.
let readyWait = Promise.resolve(false);

/**
 * Pushes onto Google's queue, and says whether that worked. A blocker that
 * leaves `adsbygoogle` defined but unusable — a frozen object, a throwing
 * push — is common enough to be worth catching rather than crashing a click.
 */
function push(item) {
  try {
    (window.adsbygoogle = window.adsbygoogle || []).push(item);
    return true;
  } catch {
    return false;
  }
}

/**
 * The switch. Called with whatever the server just said about ads; loads the
 * AdSense script if and only if that answer was 'h5' with an id behind it, and
 * otherwise does nothing at all — no tag, no preconnect, no request.
 *
 * Safe to call repeatedly: the id cannot be swapped under a script that has
 * already loaded, so the first configuration of a page is the one that stands.
 */
export function configureAdNetwork(config) {
  if (state.loading || !config?.enabled) return;
  // Before anything is read out of the answer: this surface may not have it.
  if (inAppWebView()) return;
  // The server names the network twice over. `provider` is the field the first
  // shipped clients read and it still carries the answer; `network` is the
  // object it grew into, and it is the one with the id in it. Either spelling
  // is read, so this works against a desk that predates the web network and a
  // desk that doesn't. 'adsense' is accepted for the same reason: it is what
  // somebody would reasonably have typed for the same thing.
  const net = config.network || {};
  const named = String(net.id || config.provider || '');
  if (named !== 'h5' && named !== 'adsense') return;
  const id = String(net.clientId || config.h5?.clientId || config.clientId || '').trim();
  if (!CLIENT_RE.test(id)) return;
  // Test mode is the owner's own switch on the desk, and it has to reach the
  // script tag: with Google's test publisher id and nothing else, AdSense has
  // no reason to fill and every break comes back empty.
  loadNetwork(id, !!(net.test ?? config.testMode));
}

function loadNetwork(id, test) {
  state.loading = true;

  let settle = () => {};
  readyWait = new Promise((resolve) => { settle = resolve; });
  const giveUp = () => { state.dead = true; settle(false); };
  const deadline = setTimeout(giveUp, READY_MS);
  const stop = () => clearTimeout(deadline);

  // The queue goes up before the script does — that is how this API is built,
  // and it means the config below is already waiting when the SDK drains it.
  const configured = push({
    // A rewarded game wants its ad in hand before the button is pressed, not
    // after. This is the only reason the script loads at boot rather than at
    // the press: without the head start, the first view of every session is a
    // no-fill and the house serves it.
    preloadAdBreaks: 'on',
    sound: soundOn() ? 'on' : 'off',
    onReady: () => { stop(); state.ready = true; settle(true); },
  });
  if (!configured) { stop(); giveUp(); return; }

  const script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = `${SCRIPT_SRC}?client=${encodeURIComponent(id)}`;
  // The documented way to ask H5 for house-of-Google test creatives. It is
  // only ever set from the desk's own test switch, so a live account never
  // quietly serves unpaid ads.
  if (test) script.dataset.adbreakTest = 'on';
  // A blocker usually kills the request outright, and this is how we hear
  // about it — instantly, at boot, long before anybody presses anything.
  script.onerror = () => { stop(); giveUp(); };
  document.head.appendChild(script);
}

/**
 * Plays one rewarded break and says what became of it:
 *
 *   'viewed'       watched through — the caller may redeem its ticket
 *   'dismissed'    closed early, which is always allowed and never pays
 *   'unavailable'  Google had nothing, or was never here: run the house ad
 *
 * The three are deliberately not two. A player who walked out has answered,
 * and stacking a house ad on top of that would be badgering them; a player
 * Google simply had no ad for has not answered anything, and still has five
 * seconds of reward coming.
 */
export async function playNetworkAd(slot) {
  if (!state.loading || state.dead || state.busy) return 'unavailable';
  // The press can land before the SDK has drained its queue. Waiting out the
  // rest of the readiness window costs a moment; not waiting costs the fill.
  if (!state.ready && !(await readyWait) && !state.ready) return 'unavailable';
  return runBreak(slot);
}

function runBreak(slot) {
  return new Promise((resolve) => {
    state.busy = true;
    let showing = false;
    let viewed = false;
    let dismissed = false;
    let settled = false;

    let timer = 0;
    const finish = (how) => {
      if (settled) return;
      settled = true;
      state.busy = false;
      clearTimeout(timer);
      resolve(how);
    };
    // Nothing to show is the ordinary outcome — no fill, capped, blocked — and
    // it must not leave anybody watching a button say "Loading the ad…" for
    // the rest of the evening. The clock comes down the instant Google says it
    // has one.
    timer = setTimeout(() => { if (!showing) finish('unavailable'); }, START_MS);

    // The sound hint is a live setting, not a boot one: somebody who muted the
    // table between two ads should not be shouted at by the second.
    push({ sound: soundOn() ? 'on' : 'off' });

    const queued = push({
      type: 'reward',
      name: BREAK_NAMES[slot] || 'reward',
      /**
       * Google calls this only when it actually has a rewarded ad in hand, and
       * hands over the function that shows it. This is the hook a game would
       * normally hang its own "watch an ad for coins?" prompt on — and that
       * prompt has already been shown here. It is the button they pressed to
       * get this far, and it said what the break costs and what it pays. A
       * second confirmation would just be a toll on the way to a reward they
       * have now asked for twice, so the screen goes straight to Google's own
       * reward UI, which carries its own close and its own countdown.
       */
      beforeReward: (showAdFn) => {
        showing = true;
        clearTimeout(timer);
        timer = setTimeout(() => finish('unavailable'), STUCK_MS);
        try { showAdFn(); } catch { finish('unavailable'); }
      },
      adViewed: () => { viewed = true; },
      adDismissed: () => { dismissed = true; },
      // Guaranteed after every break, including the ones where nothing
      // happened, which is why it is the only place this normally resolves.
      // The flags are read first and the status second: the callbacks are the
      // stronger statement, and a status string Google adds next year should
      // land on 'unavailable' — the house — rather than on a payout.
      adBreakDone: (info) => {
        const status = String(info?.breakStatus || '');
        if (viewed || status === 'viewed') return finish('viewed');
        if (dismissed || status === 'dismissed') return finish('dismissed');
        finish('unavailable');
      },
    });
    if (!queued) finish('unavailable');
  });
}
