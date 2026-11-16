// Sonidos sintetizados con Web Audio API (sin archivos externos).
let ctx = null;
let muted = false;

try { muted = localStorage.getItem('ortopoly.muted') === '1'; } catch { /* */ }

export function isMuted() {
  return muted;
}

export function setMuted(v) {
  muted = v;
  try { localStorage.setItem('ortopoly.muted', v ? '1' : '0'); } catch { /* */ }
}

function ac() {
  if (muted) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, { start = 0, dur = 0.12, type = 'sine', gain = 0.12, slide = null } = {}) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise({ start = 0, dur = 0.06, gain = 0.15, freq = 1800, q = 1 } = {}) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + start;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t0);
}

export const sfx = {
  dice() {
    for (let i = 0; i < 7; i += 1) noise({ start: i * 0.07 + Math.random() * 0.02, dur: 0.05, freq: 1200 + Math.random() * 1600, gain: 0.25 });
  },
  step() { tone(660, { dur: 0.05, type: 'triangle', gain: 0.05 }); },
  coin() {
    tone(988, { dur: 0.09, type: 'square', gain: 0.05 });
    tone(1319, { start: 0.08, dur: 0.18, type: 'square', gain: 0.05 });
  },
  pay() {
    tone(523, { dur: 0.1, type: 'triangle', gain: 0.08 });
    tone(392, { start: 0.09, dur: 0.16, type: 'triangle', gain: 0.08 });
  },
  buy() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, { start: i * 0.06, dur: 0.14, type: 'triangle', gain: 0.07 }));
  },
  card() { noise({ dur: 0.25, freq: 900, q: 0.6, gain: 0.12 }); tone(700, { dur: 0.25, slide: 1400, gain: 0.03 }); },
  jail() {
    [196, 185, 175].forEach((f, i) => tone(f, { start: i * 0.15, dur: 0.18, type: 'sawtooth', gain: 0.05 }));
  },
  turn() {
    [784, 988, 1175].forEach((f, i) => tone(f, { start: i * 0.08, dur: 0.22, gain: 0.07 }));
  },
  bid() { tone(880, { dur: 0.08, type: 'square', gain: 0.04 }); },
  build() { noise({ dur: 0.05, freq: 300, gain: 0.3 }); noise({ start: 0.1, dur: 0.05, freq: 300, gain: 0.3 }); },
  error() { tone(140, { dur: 0.2, type: 'sawtooth', gain: 0.05 }); },
  win() {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, { start: i * 0.12, dur: 0.25, type: 'triangle', gain: 0.08 }));
  },
  message() { tone(1200, { dur: 0.06, gain: 0.04 }); },
};
