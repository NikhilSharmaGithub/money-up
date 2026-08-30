// Tiny synthesised sound kit — no audio files, everything is generated with
// the Web Audio API so the game stays a single self-contained download.

let ctx = null;
let master = null;
let enabled = localStorage.getItem('moneymove:sound') !== 'off';

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
  localStorage.setItem('moneymove:sound', on ? 'on' : 'off');
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

const chord = (freqs, opts = {}) => freqs.forEach((f, i) => tone({ freq: f, at: i * 0.06, dur: 0.3, type: 'triangle', vol: 0.16, ...opts }));

export const sfx = {
  click: () => tone({ freq: 520, dur: 0.05, type: 'square', vol: 0.08 }),
  hover: () => tone({ freq: 900, dur: 0.03, type: 'sine', vol: 0.04 }),

  dice: () => {
    noise({ dur: 0.14, from: 2600, to: 900, vol: 0.1, q: 2 });
    noise({ dur: 0.12, from: 2000, to: 700, vol: 0.09, q: 2, at: 0.14 });
    noise({ dur: 0.1, from: 1500, to: 500, vol: 0.08, q: 2, at: 0.26 });
  },
  step: () => tone({ freq: 660, dur: 0.045, type: 'sine', vol: 0.06 }),

  buy: () => chord([523, 659, 784]),
  cash: () => { tone({ freq: 880, to: 1320, dur: 0.14, type: 'triangle', vol: 0.18 }); tone({ freq: 1320, dur: 0.16, at: 0.1, type: 'sine', vol: 0.12 }); },
  rent: () => { tone({ freq: 420, to: 200, dur: 0.28, type: 'sawtooth', vol: 0.14 }); },
  // money arriving in YOUR pocket: a bright rising coin ding
  gain: () => { tone({ freq: 988, to: 1319, dur: 0.12, type: 'triangle', vol: 0.18 }); tone({ freq: 1568, dur: 0.18, at: 0.1, type: 'sine', vol: 0.12 }); },
  // money leaving YOUR pocket: a hiss and a sagging "ishh…"
  lose: () => { noise({ dur: 0.22, from: 3200, to: 700, vol: 0.1, q: 1 }); tone({ freq: 330, to: 165, dur: 0.34, at: 0.04, type: 'triangle', vol: 0.16 }); },
  build: () => { tone({ freq: 300, dur: 0.07, type: 'square', vol: 0.14 }); tone({ freq: 460, dur: 0.09, at: 0.08, type: 'square', vol: 0.12 }); },

  card: () => noise({ dur: 0.4, from: 600, to: 3200, vol: 0.1, q: 0.7 }),
  jail: () => { tone({ freq: 200, dur: 0.18, type: 'square', vol: 0.16 }); tone({ freq: 150, dur: 0.28, at: 0.16, type: 'square', vol: 0.16 }); },
  auction: () => { tone({ freq: 700, dur: 0.08, type: 'triangle', vol: 0.16 }); tone({ freq: 1000, dur: 0.12, at: 0.09, type: 'triangle', vol: 0.14 }); },
  bid: () => tone({ freq: 760, to: 1140, dur: 0.1, type: 'triangle', vol: 0.14 }),

  turn: () => { tone({ freq: 587, dur: 0.12, type: 'sine', vol: 0.12 }); tone({ freq: 880, dur: 0.16, at: 0.1, type: 'sine', vol: 0.1 }); },
  trade: () => chord([440, 587, 740], { vol: 0.13 }),
  error: () => tone({ freq: 180, dur: 0.18, type: 'sawtooth', vol: 0.13 }),
  bankrupt: () => { tone({ freq: 400, to: 90, dur: 0.7, type: 'sawtooth', vol: 0.18 }); },
  win: () => chord([523, 659, 784, 1047, 1319], { dur: 0.5, vol: 0.18 }),
};
