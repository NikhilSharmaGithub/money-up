// Tiny synthesised sound kit — no audio files, everything is generated with
// the Web Audio API so the game stays a single self-contained download.

let ctx = null;
let master = null;
// Storage can be blocked outright; the game must still make noise.
let enabled = true;
try { enabled = localStorage.getItem('moneymove:sound') !== 'off'; } catch { /* storage blocked */ }

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setEnabled(on) {
  enabled = on;
  try { localStorage.setItem('moneymove:sound', on ? 'on' : 'off'); } catch { /* storage blocked */ }
  if (on) audio();
}
export const isEnabled = () => enabled;
export const unlock = () => { if (enabled) audio(); };

/** One oscillator blip, optionally gliding to another pitch. */
function tone({ freq = 440, to = null, dur = 0.16, type = 'sine', vol = 0.22, at = 0 }) {
  const c = audio();
  if (!c || !enabled) return;
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Filtered noise burst — used for dice tumbling and whooshes. */
function noise({ dur = 0.25, vol = 0.14, from = 1800, to = 400, at = 0, q = 1 }) {
  const c = audio();
  if (!c || !enabled) return;
  const t0 = c.currentTime + at;
  const frames = Math.floor(c.sampleRate * dur);
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, t0);
  filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const gain = c.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(gain).connect(master);
  src.start(t0);
}

// Anti-robotic rule: every play is "humanized" — a few percent of random
// detune and a few ms of timing slop, the way a real object never repeats.
const jit = (f, spread = 0.02) => f * (1 + (Math.random() * 2 - 1) * spread);
const slop = (t) => Math.max(0, t + (Math.random() * 2 - 1) * 0.012);
const rnd = (a, b) => a + Math.random() * (b - a);

/**
 * One coin, struck. A tick of bright air for the edge meeting something, the
 * ring itself, and a second partial 2.41 times up — that inharmonic partial is
 * what makes it a coin rather than a bell. Every recipe that pays, pours or
 * drops money is built out of this, so a win, a bust and a bankruptcy all
 * spend the same currency. The iPhone and Android kits hold the same helper
 * with the same numbers.
 */
function coin(at, f, v) {
  noise({ dur: 0.014, from: 5200, to: 3800, q: 6, vol: v * 0.5, at });
  tone({ freq: jit(f, 0.01), dur: 0.11, type: 'sine', vol: v, at });
  tone({ freq: jit(f * 2.41, 0.01), dur: 0.07, type: 'sine', vol: v * 0.45, at: at + 0.003 });
}

/**
 * What a piece sounds like on the move. Only the ones with an obvious voice
 * are listed; everything else — a hat, a briefcase, a diamond — keeps the
 * plain tick, because inventing a noise for a top hat is how a board starts
 * sounding like a cartoon.
 */
const STEP_KIND = {
  '🚗': 'engine', '🏎': 'engine', '🛵': 'engine', '🛺': 'engine',
  '🐕': 'paw', '🐘': 'paw', '🐅': 'paw', '🐉': 'paw',
  '🚢': 'water',
  '🚀': 'thrust',
};

export const sfx = {
  click: () => {
    // soft woodblock: two quiet partials, no square-wave beep
    tone({ freq: jit(1080), dur: 0.035, type: 'sine', vol: 0.05 });
    tone({ freq: jit(700), dur: 0.05, at: 0.004, type: 'triangle', vol: 0.04 });
  },
  hover: () => tone({ freq: jit(900), dur: 0.03, type: 'sine', vol: 0.035 }),

  // Somebody spoke. A bubble, not a notification: a short round rise with a
  // breath of air on top and nothing metallic in it, quiet enough to hear
  // twenty times a game and still not mind.
  pop: () => {
    tone({ freq: jit(430, 0.03), to: 880, dur: 0.06, type: 'sine', vol: 0.11 });
    tone({ freq: jit(1320, 0.02), dur: 0.035, at: 0.028, type: 'sine', vol: 0.045 });
    noise({ dur: 0.02, from: 2600, to: 1400, q: 3, vol: 0.03, at: 0.006 });
  },

  // Real dice: a handful of sharp clacks with irregular gaps, then a settle.
  dice: () => {
    let t = 0;
    for (let i = 0; i < 5; i++) {
      const fade = 1 - i * 0.13;
      noise({ dur: rnd(0.025, 0.045), from: rnd(2200, 3400), to: rnd(1000, 1600), q: 7, vol: 0.13 * fade, at: t });
      tone({ freq: jit(rnd(900, 2100)), dur: 0.03, type: 'triangle', vol: 0.045 * fade, at: t + 0.002 });
      t += rnd(0.045, 0.095);
    }
    tone({ freq: jit(260), to: 175, dur: 0.1, type: 'triangle', vol: 0.08, at: t + 0.02 });
  },
  step: () => tone({ freq: jit(650, 0.05), dur: 0.04, type: 'sine', vol: 0.055 }),

  // A bought piece should sound like itself when it moves.
  //
  // The trick to these being worth hearing eleven times in a row is that they
  // do not repeat. A walk is a journey: the engine pulls away and climbs, the
  // paws alternate like two feet rather than one stamp, the wash gets deeper
  // as the ship gathers way. And the last tile is not another step — it is an
  // arrival, and gets its own sound. That last beat is most of the
  // satisfaction; without it a walk just stops.
  //
  // All of it stays short and quiet on purpose. A sound that is a delight the
  // first time and a nuisance the fortieth is a badly made sound.
  stepFor: (skin, { i = 0, total = 1, last = false } = {}) => {
    const kind = STEP_KIND[String(skin || '').replace(/\uFE0F/g, '')];
    if (!kind) return sfx.step();
    // How far into the walk, 0 → 1. Everything below leans on this.
    const along = total > 1 ? i / (total - 1) : 1;

    if (kind === 'engine') {
      if (last) {
        // Off the gas, a scuff of rubber, and the body settling on its springs.
        noise({ dur: 0.14, from: 2600, to: 620, q: 2.4, vol: 0.05 });
        tone({ freq: jit(168), to: 62, dur: 0.2, type: 'sawtooth', vol: 0.055, at: 0.02 });
        tone({ freq: jit(58, 0.04), dur: 0.14, type: 'sine', vol: 0.06, at: 0.11 });
        return;
      }
      // Pulling away: a third higher by the end, never more.
      const rev = 1 + along * 0.34;
      tone({ freq: jit(76 * rev, 0.05), to: 60 * rev, dur: 0.085, type: 'sawtooth', vol: 0.055 });
      tone({ freq: jit(152 * rev, 0.04), to: 120 * rev, dur: 0.06, type: 'triangle', vol: 0.022 });
      noise({ dur: 0.032, from: 760, to: 250, q: 1.5, vol: 0.028 });
      return;
    }

    if (kind === 'paw') {
      if (last) {
        // Both feet land together, and something heavy stops being carried.
        tone({ freq: jit(140), to: 82, dur: 0.13, type: 'sine', vol: 0.085 });
        noise({ dur: 0.07, from: 620, to: 160, q: 0.9, vol: 0.045, at: 0.01 });
        tone({ freq: jit(66, 0.05), dur: 0.12, type: 'triangle', vol: 0.05, at: 0.05 });
        return;
      }
      // Left, right, left: two feet, not one stamp repeated.
      const other = i % 2 === 1;
      tone({ freq: jit(other ? 168 : 205, 0.06), to: other ? 112 : 138, dur: 0.065, type: 'sine', vol: 0.075 });
      noise({ dur: 0.03, from: other ? 430 : 540, to: 165, q: 0.85, vol: 0.03 });
      return;
    }

    if (kind === 'water') {
      if (last) {
        // The hull touching, and the wash running out from under it.
        noise({ dur: 0.26, from: 1100, to: 260, q: 0.6, vol: 0.06 });
        tone({ freq: jit(96), to: 58, dur: 0.16, type: 'sine', vol: 0.05, at: 0.02 });
        return;
      }
      // Gathering way: the wash deepens as she moves.
      noise({ dur: 0.12 + along * 0.04, from: 1600 - along * 300, to: 400, q: 0.7, vol: 0.045 + along * 0.012 });
      return;
    }

    if (kind === 'thrust') {
      if (last) {
        // Retro burn, then the legs touching down.
        noise({ dur: 0.18, from: 3200, to: 500, q: 1.1, vol: 0.055 });
        tone({ freq: jit(420), to: 120, dur: 0.16, type: 'triangle', vol: 0.045 });
        tone({ freq: jit(70, 0.05), dur: 0.12, type: 'sine', vol: 0.055, at: 0.1 });
        return;
      }
      const climb = 1 + along * 0.5;
      noise({ dur: 0.085, from: 2400 * climb, to: 850, q: 1.5, vol: 0.042 });
      tone({ freq: jit(230 * climb), to: 400 * climb, dur: 0.07, type: 'triangle', vol: 0.032 });
      return;
    }

    sfx.step();
  },

  buy: () => {
    // a warm strum, each note doubled an octave up very quietly
    [523, 659, 784].forEach((f, i) => {
      const at = slop(i * 0.07);
      tone({ freq: jit(f, 0.008), dur: 0.3, type: 'triangle', vol: 0.13, at });
      tone({ freq: jit(f * 2, 0.008), dur: 0.22, type: 'sine', vol: 0.045, at: at + 0.01 });
    });
  },
  cash: () => { tone({ freq: jit(880), to: 1320, dur: 0.14, type: 'triangle', vol: 0.16 }); tone({ freq: jit(1320), dur: 0.16, at: 0.1, type: 'sine', vol: 0.1 }); },
  rent: () => { tone({ freq: jit(420), to: 200, dur: 0.28, type: 'triangle', vol: 0.14 }); },
  // a whole country in one hand — a short triumphant flourish
  setComplete: () => {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone({ freq: jit(f, 0.006), dur: 0.3, type: 'triangle', vol: 0.14, at: i * 0.07 }));
    tone({ freq: jit(1568), dur: 0.4, type: 'sine', vol: 0.08, at: 0.32 });
  },
  // money arriving in YOUR pocket: a bright rising coin ding
  gain: () => { tone({ freq: jit(988), to: 1319, dur: 0.12, type: 'triangle', vol: 0.18 }); tone({ freq: jit(1568), dur: 0.18, at: 0.1, type: 'sine', vol: 0.12 }); },
  // money leaving YOUR pocket: a hiss and a sagging "ishh…"
  lose: () => { noise({ dur: 0.22, from: 3200, to: 700, vol: 0.1, q: 1 }); tone({ freq: jit(330), to: 165, dur: 0.34, at: 0.04, type: 'triangle', vol: 0.16 }); },
  build: () => {
    // hammer taps with wood resonance
    for (let i = 0; i < 3; i++) {
      const at = i * 0.11 + rnd(-0.01, 0.01);
      noise({ dur: 0.03, from: 2000, to: 900, q: 5, vol: 0.09, at });
      tone({ freq: jit(rnd(320, 420)), dur: 0.06, type: 'triangle', vol: 0.075, at: at + 0.002 });
    }
  },

  card: () => {
    // a paper slide, brightening as the card flips over
    noise({ dur: 0.2, from: 500, to: 1400, q: 0.8, vol: 0.08 });
    noise({ dur: 0.16, from: 1200, to: 3200, q: 0.8, vol: 0.09, at: 0.14 });
    tone({ freq: jit(880), dur: 0.06, type: 'sine', vol: 0.05, at: 0.26 });
  },
  jail: () => {
    // a cell door: metallic clank then a low slam
    noise({ dur: 0.05, from: 3500, to: 2200, q: 9, vol: 0.12 });
    tone({ freq: jit(520), to: 490, dur: 0.09, at: 0.01, type: 'square', vol: 0.05 });
    tone({ freq: jit(150), to: 110, dur: 0.3, at: 0.12, type: 'triangle', vol: 0.15 });
    noise({ dur: 0.12, from: 400, to: 150, q: 1, vol: 0.08, at: 0.12 });
  },
  auction: () => {
    // gavel: two woody knocks
    noise({ dur: 0.035, from: 1800, to: 900, q: 6, vol: 0.13 });
    tone({ freq: jit(820), dur: 0.05, type: 'triangle', vol: 0.09, at: 0.002 });
    noise({ dur: 0.035, from: 1700, to: 850, q: 6, vol: 0.11, at: 0.16 });
    tone({ freq: jit(760), dur: 0.05, type: 'triangle', vol: 0.08, at: 0.162 });
  },
  // a paddle shoots up: crisp tick, then a ding that climbs with the stakes
  bid: (amount = 0) => {
    const lift = Math.min(Math.max(amount, 0), 1200) * 0.35;
    noise({ dur: 0.025, from: 3000, to: 1800, q: 8, vol: 0.09 });
    tone({ freq: jit(620 + lift), to: 940 + lift, dur: 0.16, at: 0.012, type: 'triangle', vol: 0.16 });
    tone({ freq: jit(1240 + lift, 0.008), dur: 0.14, at: 0.055, type: 'sine', vol: 0.07 });
  },

  turn: () => {
    // a doorbell third with a hint of shimmer
    tone({ freq: jit(587, 0.006), dur: 0.14, type: 'sine', vol: 0.12 });
    tone({ freq: jit(589, 0.006), dur: 0.14, type: 'sine', vol: 0.05 });
    tone({ freq: jit(880, 0.006), dur: 0.2, at: 0.11, type: 'sine', vol: 0.1 });
    tone({ freq: jit(884, 0.006), dur: 0.2, at: 0.11, type: 'sine', vol: 0.04 });
  },
  trade: () => {
    [440, 587, 740].forEach((f, i) => tone({ freq: jit(f, 0.008), dur: 0.26, type: 'triangle', vol: 0.11, at: slop(i * 0.08) }));
    tone({ freq: jit(1174), dur: 0.18, type: 'sine', vol: 0.05, at: 0.24 });
  },
  error: () => tone({ freq: jit(180), dur: 0.18, type: 'triangle', vol: 0.13 }),

  // ── A bankruptcy, heard three ways ──
  // One event, and the table hears it from three chairs. The player it
  // happened to gets the comic fall; the player who did it gets the till
  // ringing; everyone else hears a pile of money hit the floor. Played once,
  // when the bust is shown — which is after the piece that caused it has
  // landed, never while it is still walking there.

  // Yours: three sad-trombone steps, each sagging a semitone as it sounds,
  // then the long "wah-wah" — a detuned twin beating against it — the thud
  // of the floor, and the last of your money rolling away from you.
  bankruptFall: () => {
    [[0, 392], [0.29, 370], [0.58, 349.2]].forEach(([t, f]) => {
      tone({ freq: jit(f, 0.005), to: f * 0.95, dur: 0.26, type: 'triangle', vol: 0.12, at: t });
      tone({ freq: f / 2, to: f * 0.475, dur: 0.26, type: 'sine', vol: 0.05, at: t });
    });
    tone({ freq: 329.6, to: 207.7, dur: 0.9, type: 'triangle', vol: 0.13, at: 0.87 });
    tone({ freq: 333.4, to: 210, dur: 0.9, type: 'triangle', vol: 0.05, at: 0.87 });
    tone({ freq: 164.8, to: 103.8, dur: 0.9, type: 'sine', vol: 0.06, at: 0.87 });
    tone({ freq: 90, to: 48, dur: 0.32, type: 'sine', vol: 0.13, at: 1.62 });
    noise({ dur: 0.28, from: 500, to: 120, q: 0.8, vol: 0.07, at: 1.62 });
    coin(1.70, 1760, 0.035);
    coin(1.86, 1480, 0.028);
    coin(2.06, 1250, 0.02);
  },

  // The creditor's: a cash register. Keys, the drawer thrown open, the bell,
  // a rising sting into a bright chord, and the takings dropped into the till
  // one coin after another.
  bankruptKaching: () => {
    noise({ dur: 0.03, from: 3000, to: 1700, q: 6, vol: 0.11, at: 0 });
    tone({ freq: jit(210), to: 150, dur: 0.05, type: 'triangle', vol: 0.06, at: 0.002 });
    noise({ dur: 0.05, from: 1600, to: 700, q: 2, vol: 0.10, at: 0.07 });
    tone({ freq: jit(140), to: 95, dur: 0.08, type: 'triangle', vol: 0.07, at: 0.075 });
    tone({ freq: 2093, dur: 0.7, type: 'sine', vol: 0.10, at: 0.12 });
    tone({ freq: 2637, dur: 0.5, type: 'sine', vol: 0.05, at: 0.121 });
    tone({ freq: 4186, dur: 0.28, type: 'sine', vol: 0.025, at: 0.122 });
    tone({ freq: 1046.5, dur: 0.55, type: 'triangle', vol: 0.045, at: 0.12 });
    tone({ freq: jit(783.99, 0.004), to: 1046.5, dur: 0.14, type: 'triangle', vol: 0.09, at: 0.22 });
    tone({ freq: 1046.5, dur: 0.45, type: 'triangle', vol: 0.08, at: 0.34 });
    tone({ freq: 1318.5, dur: 0.45, type: 'triangle', vol: 0.065, at: 0.35 });
    tone({ freq: 1568, dur: 0.5, type: 'sine', vol: 0.045, at: 0.36 });
    [[0.40, 0.05], [0.46, 0.047], [0.51, 0.044], [0.58, 0.04], [0.67, 0.035], [0.79, 0.03]]
      .forEach(([t, v]) => coin(t, rnd(2000, 2900), v));
  },

  // Everyone else's: the weight of it landing, the old fall underneath, a
  // crash, a dozen coins scattering further apart as they go (each gap 1.2×
  // the last), and one coin left spinning down until it lies flat.
  bankruptCrash: () => {
    tone({ freq: jit(130), to: 70, dur: 0.24, type: 'sine', vol: 0.10, at: 0 });
    noise({ dur: 0.20, from: 2000, to: 600, q: 0.9, vol: 0.09, at: 0 });
    tone({ freq: jit(400), to: 110, dur: 0.55, type: 'triangle', vol: 0.06, at: 0 });
    noise({ dur: 0.12, from: 5200, to: 2600, q: 1.2, vol: 0.08, at: 0.015 });
    [0.030, 0.052, 0.078, 0.110, 0.148, 0.194, 0.249, 0.315, 0.394, 0.489, 0.602, 0.738]
      .forEach((t, k) => coin(t, rnd(1600, 3000), 0.05 * (1 - 0.055 * k)));
    [0.86, 0.93, 0.99, 1.04, 1.08, 1.11].forEach((t, j) => {
      noise({ dur: 0.01, from: 4200, to: 3000, q: 5, vol: 0.03 * (1 - 0.1 * j), at: t });
      tone({ freq: jit(2400, 0.02), dur: 0.02, type: 'sine', vol: 0.015, at: t });
    });
    tone({ freq: jit(1900), dur: 0.06, type: 'sine', vol: 0.02, at: 1.15 });
  },
  // an accelerating riffle of card snaps, then a rising run
  shuffle: () => {
    let t = 0, gap = 0.085;
    for (let i = 0; i < 9; i++) {
      noise({ dur: 0.03, from: rnd(1800, 2600), to: rnd(900, 1300), q: 5, vol: 0.06 + i * 0.006, at: t });
      t += gap;
      gap = Math.max(0.028, gap * 0.82);
    }
    noise({ dur: 0.24, from: 1400, to: 500, q: 1, vol: 0.09, at: t });
    [392, 494, 587, 784].forEach((f, i) => tone({ freq: jit(f, 0.006), dur: 0.18, type: 'triangle', vol: 0.09, at: t + 0.18 + i * 0.07 }));
  },
  // The game is over. The winner hears a pickup arpeggio into a held C major
  // (a +5-cent twin on the top C gives it its shimmer), a run of sparkle, and
  // then their winnings poured out: nine coins that pour and slow, and the
  // pile settling. Everyone else hears the same fanfare a little quieter and
  // without the coins — the table cheering, not their own till.
  win: (mine = true) => {
    const k = mine ? 1 : 0.75;
    [392, 523.25, 659.25, 783.99].forEach((f, i) => {
      const at = slop(0.075 * i);
      tone({ freq: jit(f, 0.006), dur: 0.18, type: 'triangle', vol: 0.10 * k, at });
      tone({ freq: jit(2 * f, 0.006), dur: 0.12, type: 'sine', vol: 0.03 * k, at: at + 0.01 });
    });
    tone({ freq: 130.8, dur: 1.2, type: 'sine', vol: 0.09 * k, at: 0.32 });
    tone({ freq: jit(523.25, 0.004), dur: 1.3, type: 'triangle', vol: 0.085 * k, at: 0.32 });
    tone({ freq: jit(659.25, 0.004), dur: 1.3, type: 'triangle', vol: 0.07 * k, at: 0.33 });
    tone({ freq: jit(783.99, 0.004), dur: 1.3, type: 'triangle', vol: 0.065 * k, at: 0.34 });
    tone({ freq: 1046.5, dur: 1.4, type: 'sine', vol: 0.055 * k, at: 0.32 });
    tone({ freq: 1049.5, dur: 1.4, type: 'sine', vol: 0.025 * k, at: 0.32 });
    tone({ freq: jit(1318.5, 0.004), dur: 0.9, type: 'sine', vol: 0.04 * k, at: 0.40 });
    if (!mine) return;
    [2093, 2637, 3136, 3520, 4186].forEach((f, i) =>
      tone({ freq: jit(f, 0.01), dur: 0.16, type: 'sine', vol: 0.026, at: 0.46 + 0.065 * i }));
    [0.62, 0.69, 0.75, 0.80, 0.85, 0.905, 0.97, 1.05, 1.15]
      .forEach((t, i) => coin(slop(t), rnd(1900, 2800), 0.055 * (1 - 0.06 * i)));
    noise({ dur: 0.16, from: 1500, to: 600, q: 1, vol: 0.04, at: 1.24 });
    coin(1.30, 2200, 0.025);
  },

  // The app opening, on the iPhone and Android splash: a die tumbling in with
  // three clacks, landing as its spring settles, a warm G to C as the
  // wordmark rises, and a slow shimmer under the tagline, rung out before the
  // splash fades. The web has no splash, and a browser will not let a page
  // make a sound before it has been touched — so here it plays once, on the
  // first touch of the landing, which is the web's moment of opening.
  launch: () => {
    [0, 0.11, 0.21].forEach((base, i) => {
      const t = slop(base);
      const fade = 1 - 0.2 * i;
      noise({ dur: rnd(0.025, 0.045), from: rnd(2200, 3400), to: rnd(1000, 1600), q: 7, vol: 0.10 * fade, at: t });
      tone({ freq: jit(rnd(900, 2100)), dur: 0.03, type: 'triangle', vol: 0.04 * fade, at: t + 0.002 });
    });
    tone({ freq: jit(260), to: 175, dur: 0.12, type: 'triangle', vol: 0.10, at: 0.40 });
    tone({ freq: jit(1500), dur: 0.03, type: 'sine', vol: 0.035, at: 0.412 });
    tone({ freq: 98, to: 92, dur: 0.30, type: 'sine', vol: 0.08, at: 0.40 });
    noise({ dur: 0.06, from: 600, to: 200, q: 0.9, vol: 0.05, at: 0.40 });
    tone({ freq: jit(392, 0.004), dur: 0.55, type: 'triangle', vol: 0.10, at: 0.66 });
    tone({ freq: jit(784, 0.004), dur: 0.40, type: 'sine', vol: 0.035, at: 0.67 });
    tone({ freq: 196, dur: 0.50, type: 'sine', vol: 0.05, at: 0.66 });
    tone({ freq: jit(523.25, 0.004), dur: 0.95, type: 'triangle', vol: 0.11, at: 0.86 });
    tone({ freq: jit(659.25, 0.004), dur: 0.80, type: 'sine', vol: 0.04, at: 0.88 });
    tone({ freq: 261.6, dur: 0.95, type: 'sine', vol: 0.06, at: 0.86 });
    tone({ freq: jit(1046.5, 0.004), dur: 0.60, type: 'sine', vol: 0.03, at: 0.87 });
    tone({ freq: 2093, dur: 0.55, type: 'sine', vol: 0.02, at: 0.98 });
    tone({ freq: 2097, dur: 0.55, type: 'sine', vol: 0.012, at: 0.98 });
    tone({ freq: 3136, dur: 0.40, type: 'sine', vol: 0.014, at: 1.06 });
  },
};
