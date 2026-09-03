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
  bankrupt: () => {
    tone({ freq: jit(400), to: 90, dur: 0.7, type: 'triangle', vol: 0.16 });
    noise({ dur: 0.4, from: 500, to: 120, q: 0.8, vol: 0.06, at: 0.15 });
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
  win: () => {
    [523, 659, 784, 1047, 1319].forEach((f, i) => {
      const at = slop(i * 0.09);
      tone({ freq: jit(f, 0.006), dur: 0.5, type: 'triangle', vol: 0.14, at });
      tone({ freq: jit(f * 2, 0.006), dur: 0.3, type: 'sine', vol: 0.04, at: at + 0.02 });
    });
  },
};
