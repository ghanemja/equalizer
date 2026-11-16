// "How a rap beat is made" reel: the soundtrack and the data the video draws.
// Every sound is an equation rendered by equalizer. On top of that this script does
// what a producer does in a mix: real biquad EQ (RBJ cookbook), sidechain ducking
// of the 808 under the kick, panning, a tanh soft clip on the bus and a -1 dBFS peak.
//
// Usage: node examples/reel/beat.mjs <outDir>   -> reel.wav + reel-data.json
import { writeFileSync, mkdirSync } from 'node:fs';
import { renderTrack, triggers, toWav } from '../../src/equalizer.js';

const OUT = process.argv[2] ?? 'reel-out';
mkdirSync(OUT, { recursive: true });

export const BPM = 140;
const SR = 44100;
const SPB = 60 / BPM;            // seconds per beat: 0.4286
const BAR = 4 * SPB;             // 1.714 s
const STEP = SPB / 4;            // a 16th note
const BARS = 28;
const DURATION = BARS * BAR + 1.6;
const N = Math.ceil(DURATION * SR);
const song = { bpm: BPM, duration: DURATION };
const during = (a, b) => `bar >= ${a} && bar < ${b}`;

// ---- Arrangement (bars) ------------------------------------------------------------
// 0-2 intro keys | 2 kick | 4 snare | 6 hats | 8 808 | 12 chords | 16 EQ | 20 sidechain | 22 full mix | 26 outro
export const SECTIONS = [
  { id: 'intro', from: 0, to: 2 },
  { id: 'kick', from: 2, to: 4 },
  { id: 'snare', from: 4, to: 6 },
  { id: 'hats', from: 6, to: 8 },
  { id: '808', from: 8, to: 12 },
  { id: 'chords', from: 12, to: 16 },
  { id: 'eq', from: 16, to: 20 },
  { id: 'sidechain', from: 20, to: 22 },
  { id: 'mix', from: 22, to: 26 },
  { id: 'outro', from: 26, to: BARS },
];

// Four-bar patterns, 16 steps per bar. Trap at 140 is felt half-time: snare on beat 3.
const KICK = 'x.........x.....' + 'x.........x..x..' + 'x.........x.....' + 'x......x..x.....';
const SNARE = '........x.......'.repeat(4);
// The 808 plays the chord roots on the kick's rhythm (C minor: i - VI - iv - V).
const ROOTS = ['C2', 'Ab1', 'F1', 'G1'];
const bass808 = [
  `C2 . . . . . . . . . C2 . . . . .`,
  `Ab1 . . . . . . . . . Ab1 . . Ab1 . .`,
  `F1 . . . . . . . . . F1 . . . . .`,
  `G1 . . . . . . G1 . . G1 . . . - .`, // stop at step 14: the glide note takes over
].join(' ');
const slide808 = '. '.repeat(62) + 'G1 .';  // bar 4, step 14: G1 gliding up a fourth into C2
const CHORDS = ['C3+G3+Bb3+D4+Eb4', 'Ab2+Eb3+G3+Bb3+C4', 'F2+C3+Eb3+Ab3+G3', 'G2+F3+B3+D4'];
export const CHORD_NAMES = ['Cm9', 'Abmaj9', 'Fm9', 'G7'];
const keysPattern = CHORDS.map((c) => `${c} . . . . . . ${c} . . . . . . . .`).join(' ');
const padPattern = ['C3+Eb3+G3', 'Ab2+C3+Eb3', 'F2+Ab2+C3', 'G2+B2+D3'].map((c) => `${c} ${'. '.repeat(15)}`).join(' ').trim();

// Hi-hats: 8ths with 56% swing, 16th fills and a triplet -> 32nd roll on bar 4.
const SWING = 0.56;
const HAT_STEPS = [
  [0, 2, 4, 6, 8, 10, 12, 14],
  [0, 2, 4, 6, 8, 10, 12, 13, 14, 15],
  [0, 2, 4, 6, 7, 8, 10, 12, 14],
  [0, 2, 4, 6, 8, 10, 12, 12 + 2 / 3, 12 + 4 / 3, 14, 14.5, 15, 15.5],
];
function hatTimes(fromBar, toBar) {
  const out = [];
  for (let bar = fromBar; bar < toBar; bar++) {
    for (const s of HAT_STEPS[bar % 4]) {
      // off-beat 8ths (steps 2, 6, 10, 14) land at 56% of the beat instead of 50%
      const swung = s % 4 === 2 ? s + (SWING - 0.5) * 4 : s;
      out.push(bar * BAR + swung * STEP);
    }
  }
  return out;
}

// ---- Instruments: equations -------------------------------------------------------
const TRACKS = {
  kick: {
    equation: 'sin(TAU * (base*tau + punch*(1 - exp(-tau*sweep))/sweep)) * exp(-tau*decay) + click*noise()*exp(-tau*600)',
    params: { base: 52, punch: 180, sweep: 30, decay: 9, click: 0.12 },
    pattern: KICK, gate: during(2, 26), len: 0.5,
  },
  snare: {
    equation: 'tone * sin(TAU*(body*tau + 60*(1 - exp(-tau*40))/40)) * exp(-tau*18) + (1 - tone) * noise() * exp(-tau*decay)',
    params: { tone: 0.45, body: 190, decay: 14 },
    pattern: SNARE, gate: during(4, 26), hp: 100, lp: 8000, len: 0.4,
  },
  clap: {
    equation: 'noise() * (exp(-tau*decay) + 0.8*exp(-abs(tau - gap)*400) + 0.6*exp(-abs(tau - 2*gap)*400))',
    params: { decay: 16, gap: 0.011 },
    pattern: SNARE, gate: during(4, 26), hp: 700, lp: 7500, len: 0.3,
  },
  hats: {
    equation: '((sqr(tau*317) + sqr(tau*465) + sqr(tau*820) + sqr(tau*1150) + sqr(tau*1600) + sqr(tau*2200))/6 * metal + noise() * (1 - metal)) * exp(-tau*decay) * (0.7 + 0.3*r)',
    params: { metal: 0.3, decay: 60 },
    at: [...hatTimes(6, 25), ...hatTimes(25, 26).slice(0, 6)], hp: 5000, lp: 10000, len: 0.12,
  },
  '808': {
    equation: 'tanh(sat*sin(TAU*f*tau)) * ad(tau, 0.004, decay)',
    params: { sat: 2.5, decay: 1.2 },
    pattern: bass808, gate: during(8, 27), len: 2.2,
  },
  '808 glide': {
    // linear glide from f to f*2^(5/12) starting at ts, lasting td seconds (phase = integral of f(t))
    equation: 'tanh(sat*sin(TAU*(f*tau + f*(2^(semi/12) - 1)*(min(max(tau - ts, 0), td)^2/(2*td) + max(tau - ts - td, 0))))) * ad(tau, 0.004, decay)',
    params: { sat: 2.5, decay: 1.2, semi: 5, ts: 0.06, td: 0.12 },
    pattern: slide808, gate: during(8, 26), len: 0.24,
  },
  keys: {
    // electric piano: fundamental plus fast-decaying 2nd and 3rd harmonics, slow tremolo
    equation: '(sin(TAU*f*tau) + bright*(0.3*sin(TAU*2*f*tau)*exp(-tau*3) + 0.08*sin(TAU*3*f*tau)*exp(-tau*6))) * ad(tau, 0.01, decay) * (1 + trem*sin(TAU*4*t))',
    params: { bright: 1, decay: 0.9, trem: 0.12 },
    pattern: keysPattern, gate: `bar < 2 || (bar >= 12 && bar < ${BARS})`, lp: 3000,
  },
  pad: {
    equation: '(sin(TAU*f*tau) + 0.4*sin(TAU*2.003*f*tau)) / 1.4 * min(1, tau/attack)',
    params: { attack: 0.5 },
    pattern: padPattern, gate: during(22, BARS), lp: 900,
  },
};

// ---- Biquads (Robert Bristow-Johnson's Audio EQ Cookbook) --------------------------
function biquad(type, f0, { q = Math.SQRT1_2, db = 0 } = {}) {
  const A = 10 ** (db / 40), w = 2 * Math.PI * f0 / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
  let b, a;
  if (type === 'hp') { b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]; a = [1 + al, -2 * c, 1 - al]; }
  if (type === 'lp') { b = [(1 - c) / 2, 1 - c, (1 - c) / 2]; a = [1 + al, -2 * c, 1 - al]; }
  if (type === 'peak') { b = [1 + al * A, -2 * c, 1 - al * A]; a = [1 + al / A, -2 * c, 1 - al / A]; }
  if (type === 'highshelf') {
    const k = 2 * Math.sqrt(A) * al;
    b = [A * ((A + 1) + (A - 1) * c + k), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - k)];
    a = [(A + 1) - (A - 1) * c + k, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - k];
  }
  return { type, f0, q, db, b: b.map((x) => x / a[0]), a: [1, a[1] / a[0], a[2] / a[0]] };
}
function applyBiquad(x, { b, a }) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
/** |H(e^{jw})| in dB for a chain of biquads, at frequency f. */
function chainDb(chain, f) {
  const w = 2 * Math.PI * f / SR;
  let db = 0;
  for (const { b, a } of chain) {
    const re = (c) => c[0] + c[1] * Math.cos(w) + c[2] * Math.cos(2 * w);
    const im = (c) => -(c[1] * Math.sin(w) + c[2] * Math.sin(2 * w));
    const num = Math.hypot(re(b), im(b)), den = Math.hypot(re(a), im(a));
    db += 20 * Math.log10(num / den);
  }
  return db;
}

// EQ per stem; each filter switches on at a bar (the EQ section turns them on one by one).
const EQ = {
  kick: [[18, biquad('hp', 30)], [18, biquad('peak', 55, { db: 2, q: 1 })], [18, biquad('peak', 400, { db: -3, q: 1.2 })]],
  snare: [[18, biquad('hp', 110)], [18, biquad('peak', 220, { db: 2, q: 1.2 })]],
  clap: [[18, biquad('hp', 900)]],
  hats: [[19, biquad('lp', 9000)], [19, biquad('highshelf', 6000, { db: -3 })]],
  '808': [[18, biquad('hp', 28)], [18, biquad('peak', 300, { db: -2, q: 1 })], [18, biquad('lp', 3500)]],
  '808 glide': [[18, biquad('hp', 28)], [18, biquad('peak', 300, { db: -2, q: 1 })], [18, biquad('lp', 3500)]],
  keys: [[17, biquad('hp', 180)], [18, biquad('peak', 350, { db: -4, q: 1.1 })], [19, biquad('highshelf', 4000, { db: -3 })]],
  pad: [[17, biquad('hp', 200)], [17, biquad('lp', 1500)]],
};
const MIX = {
  kick: { gain: 1.0, pan: 0 }, snare: { gain: 1.4, pan: 0 }, clap: { gain: 0.7, pan: -0.08 },
  hats: { gain: 0.6, pan: 0.18 }, '808': { gain: 0.42, pan: 0 }, '808 glide': { gain: 0.42, pan: 0 },
  keys: { gain: 0.62, pan: -0.06 }, pad: { gain: 0.22, pan: 0.1 },
};
const SIDECHAIN_FROM = 20 * BAR, DUCK = { '808': 0.5, '808 glide': 0.5, keys: 0.2, pad: 0.2 }, DUCK_TAU = 0.08;

// ---- Render ------------------------------------------------------------------------
const fade = (t, at, ms = 0.015) => Math.min(1, Math.max(0, (t - at) / ms + 0.5));
const kickTimes = triggers(TRACKS.kick, song, DURATION).map((h) => h.time);
const events = {};
const stems = {};
for (const [name, tr] of Object.entries(TRACKS)) {
  const raw = renderTrack(tr, song, { sampleRate: SR, duration: DURATION });
  events[name] = triggers(tr, song, DURATION).map((h) => ({ t: +h.time.toFixed(4), n: h.notes.length }));
  // cumulative EQ stages, crossfaded in at their bar
  let out = raw;
  for (const [bar, filt] of EQ[name] ?? []) {
    const wet = applyBiquad(out, filt);
    const at = bar * BAR;
    const merged = new Float32Array(N);
    for (let i = 0; i < N; i++) { const k = fade(i / SR, at); merged[i] = out[i] * (1 - k) + wet[i] * k; }
    out = merged;
  }
  // sidechain: g(t) = 1 - d * exp(-(t - t_kick) / tau), with a 3 ms attack so it doesn't click
  if (DUCK[name]) {
    let k = 0;
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      if (t < SIDECHAIN_FROM) continue;
      while (k + 1 < kickTimes.length && kickTimes[k + 1] <= t) k++;
      const tk = kickTimes[k];
      if (tk > t) continue;
      const dt = t - tk;
      out[i] *= 1 - DUCK[name] * Math.min(1, dt / 0.003) * Math.exp(-dt / DUCK_TAU) * fade(t, SIDECHAIN_FROM, 0.05);
    }
  }
  stems[name] = out;
}

const left = new Float32Array(N), right = new Float32Array(N), mono = new Float32Array(N);
for (const [name, buf] of Object.entries(stems)) {
  const { gain, pan } = MIX[name];
  const gl = Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2 * gain, gr = Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2 * gain;
  for (let i = 0; i < N; i++) { left[i] += buf[i] * gl; right[i] += buf[i] * gr; }
}
// bus: tanh soft clip, then peak at -1 dBFS, short fade at the very end
const DRIVE = 0.75;
let peak = 0;
for (let i = 0; i < N; i++) {
  left[i] = Math.tanh(left[i] * DRIVE); right[i] = Math.tanh(right[i] * DRIVE);
  peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
}
const norm = 10 ** (-1 / 20) / peak;
const fadeLen = Math.round(1.2 * SR);
for (let i = 0; i < N; i++) {
  const f = i > N - fadeLen ? (N - i) / fadeLen : 1;
  left[i] *= norm * f; right[i] *= norm * f; mono[i] = (left[i] + right[i]) / 2;
}
writeFileSync(`${OUT}/reel.wav`, toWav(left, right, SR));

// ---- Data for the video: spectrum per frame, levels, EQ curves ---------------------
const FPS = 30, FFT = 4096, BANDS = 96, FMIN = 25, FMAX = 16000;
const bandHz = Array.from({ length: BANDS + 1 }, (_, k) => FMIN * (FMAX / FMIN) ** (k / BANDS));
const hann = Float64Array.from({ length: FFT }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT - 1)));
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}
const frames = Math.ceil(DURATION * FPS);
const spectrum = [], level = [], scope = [];
for (let fr = 0; fr < frames; fr++) {
  const end = Math.round(fr / FPS * SR);
  const re = new Float64Array(FFT), im = new Float64Array(FFT);
  for (let i = 0; i < FFT; i++) { const j = end - FFT + i; re[i] = (j >= 0 && j < N ? mono[j] : 0) * hann[i]; }
  fft(re, im);
  const mags = [];
  for (let k = 0; k < BANDS; k++) {
    const lo = Math.max(1, Math.floor(bandHz[k] * FFT / SR)), hi = Math.max(lo, Math.floor(bandHz[k + 1] * FFT / SR));
    let p = 0;
    for (let bin = lo; bin <= hi; bin++) p = Math.max(p, re[bin] ** 2 + im[bin] ** 2);
    mags.push(Math.round(Math.max(-90, 10 * Math.log10(p / (FFT / 4) ** 2 + 1e-12))));
  }
  spectrum.push(mags);
  let rms = 0;
  for (let i = Math.max(0, end - 1470); i < end; i++) rms += mono[i] ** 2;
  level.push(+(10 * Math.log10(rms / 1470 + 1e-9)).toFixed(1));
  const pts = [];
  for (let k = 0; k < 160; k++) { const j = end - 1600 + k * 10; pts.push(+((j >= 0 && j < N ? mono[j] : 0)).toFixed(3)); }
  scope.push(pts);
}
const curveHz = Array.from({ length: 120 }, (_, k) => FMIN * (FMAX / FMIN) ** (k / 119));
const curve = (name, uptoBar) => curveHz.map((f) => +chainDb((EQ[name] ?? []).filter(([b]) => b <= uptoBar).map(([, x]) => x), f).toFixed(2));
const eqCurves = {};
for (const name of ['keys', '808', 'hats', 'kick']) eqCurves[name] = { 17: curve(name, 17), 18: curve(name, 18), 19: curve(name, 19) };

writeFileSync(`${OUT}/reel-data.json`, JSON.stringify({
  bpm: BPM, bar: BAR, step: STEP, duration: DURATION, fps: FPS, frames, sections: SECTIONS,
  bandHz, curveHz, spectrum, level, scope, eqCurves, events, kickTimes, chords: CHORD_NAMES, roots: ROOTS,
  sidechain: { from: SIDECHAIN_FROM, depth: 0.5, tau: DUCK_TAU },
}));

// Stem loudness report, to sanity-check the balance
for (const [name, buf] of Object.entries(stems)) {
  let p = 0, s = 0, n = 0;
  for (let i = Math.round(22 * BAR * SR); i < Math.round(26 * BAR * SR); i++) { const v = buf[i] * MIX[name].gain; s += v * v; n++; p = Math.max(p, Math.abs(v)); }
  console.log(name.padEnd(10), 'rms', (10 * Math.log10(s / n + 1e-12)).toFixed(1), 'dB  peak', (20 * Math.log10(p + 1e-12)).toFixed(1), 'dB');
}
console.log(`${OUT}/reel.wav  ${DURATION.toFixed(2)}s, ${frames} frames`);
