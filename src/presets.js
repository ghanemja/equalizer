// Built-in equations ("instruments") and example songs.
// Each param is { value, min, max } so an app can draw it as a knob.

const P = (value, min, max) => ({ value, min, max });

export const INSTRUMENTS = [
  // --- Drums ---
  {
    id: 'kick', name: 'Kick · sine drop', kind: 'drums',
    equation: 'sin(TAU * (base*tau + punch*(1 - exp(-tau*sweep))/sweep)) * exp(-tau*decay)',
    params: { base: P(48, 30, 100), punch: P(160, 0, 500), sweep: P(28, 5, 100), decay: P(7, 2, 25) },
    pattern: 'x...x...x...x...', gain: 0.95,
  },
  {
    id: 'kick808', name: 'Kick · 808 boom', kind: 'drums',
    equation: 'tanh(drive * sin(TAU * (base*tau + punch*(1 - exp(-tau*sweep))/sweep))) * exp(-tau*decay)',
    params: { base: P(42, 25, 80), punch: P(90, 0, 300), sweep: P(20, 5, 60), decay: P(2.5, 0.5, 10), drive: P(2, 1, 8) },
    pattern: 'x.........x.....', gain: 0.9,
  },
  {
    id: 'snare', name: 'Snare · tone + noise', kind: 'drums',
    equation: '(tone * sin(TAU*body*tau) * exp(-tau*20) + (1 - tone) * noise()) * exp(-tau*decay)',
    params: { tone: P(0.35, 0, 1), body: P(185, 100, 400), decay: P(16, 5, 40) },
    pattern: '....x.......x...', hp: 180, gain: 0.7,
  },
  {
    id: 'clap', name: 'Clap · three hands', kind: 'drums',
    equation: 'noise() * (exp(-tau*decay) + 0.8*exp(-abs(tau - gap)*400) + 0.6*exp(-abs(tau - 2*gap)*400))',
    params: { decay: P(18, 6, 40), gap: P(0.011, 0.004, 0.03) },
    pattern: '....x.......x...', hp: 900, gain: 0.55,
  },
  {
    id: 'hat', name: 'Hat · six squares', kind: 'drums',
    equation: '((sqr(tau*317*tune) + sqr(tau*465*tune) + sqr(tau*820*tune) + sqr(tau*1150*tune) + sqr(tau*1600*tune) + sqr(tau*2200*tune))/6 * metal + noise() * (1 - metal)) * exp(-tau*decay)',
    params: { tune: P(1, 0.5, 2), metal: P(0.6, 0, 1), decay: P(55, 8, 150) },
    pattern: '..x...x...x...x.', hp: 6000, gain: 0.45,
  },
  {
    id: 'shaker', name: 'Shaker · swung noise', kind: 'drums',
    equation: 'noise() * ad(tau, attack, decay) * (0.6 + 0.4*sin(TAU*beat*2))',
    params: { attack: P(0.012, 0.001, 0.05), decay: P(40, 10, 120) },
    pattern: 'xxxxxxxxxxxxxxxx', hp: 5000, gain: 0.3,
  },
  {
    id: 'tom', name: 'Tom · pitched drop', kind: 'drums',
    equation: 'sin(TAU * (pitch*tau + pitch*(1 - exp(-tau*12))/12)) * exp(-tau*decay)',
    params: { pitch: P(120, 60, 300), decay: P(9, 3, 25) },
    pattern: '..............x.', gain: 0.6,
  },
  {
    id: 'rim', name: 'Rim · knock', kind: 'drums',
    equation: 'sin(TAU*pitch*tau) * exp(-tau*decay) + noise() * exp(-tau*300) * 0.3',
    params: { pitch: P(820, 300, 2000), decay: P(45, 15, 120) },
    pattern: '...x.....x....x.', gain: 0.4,
  },

  // --- Bass ---
  {
    id: 'sub', name: 'Bass · pure sub', kind: 'bass',
    equation: 'sin(TAU*f*tau) * ad(tau, 0.005, decay)',
    params: { decay: P(2, 0.2, 8) },
    pattern: 'C2 . . . . . . . A1 . . . . . . . F1 . . . . . . . G1 . . . . . . .', gain: 0.8,
  },
  {
    id: 'sawbass', name: 'Bass · saw + sub', kind: 'bass',
    equation: '(saw(f*tau) * 0.7 + sin(TAU*f/2*tau) * sub) * ad(tau, 0.004, decay)',
    params: { sub: P(0.6, 0, 1), decay: P(3, 0.5, 12) },
    pattern: '. . C2 . . . C2 . . . C2 . . . C2 .', lp: 520, gain: 0.7,
  },
  {
    id: 'fmbass', name: 'Bass · FM growl', kind: 'bass',
    equation: 'sin(TAU*f*tau + index*exp(-tau*fall)*sin(TAU*f*ratio*tau)) * ad(tau, 0.003, decay)',
    params: { index: P(3, 0, 10), ratio: P(1, 0.5, 4), fall: P(6, 0, 30), decay: P(3, 0.5, 12) },
    pattern: 'C2 . C2 . . . C2 . Eb2 . . . F2 . G2 .', lp: 1400, gain: 0.6,
  },
  {
    id: 'wobble', name: 'Bass · wobble', kind: 'bass',
    equation: 'saw(f*tau) * (0.55 + 0.45*sin(TAU*rate*beat))',
    params: { rate: P(2, 0.25, 8) },
    pattern: 'C2 . . . . . . . . . . . . . . . Eb2 . . . . . . . . . . . G1 . . .', lp: 800, gain: 0.55,
  },

  // --- Keys and leads ---
  {
    id: 'pluck', name: 'Keys · harmonic pluck', kind: 'keys',
    equation: '(sin(TAU*f*tau) + bright*sin(TAU*2*f*tau) + bright^2*sin(TAU*3*f*tau)) / (1 + bright + bright^2) * exp(-tau*decay)',
    params: { bright: P(0.35, 0, 1), decay: P(9, 2, 30) },
    pattern: 'C5 E5 G5 E5 C5 E5 G5 C6 A4 C5 E5 C5 A4 C5 E5 A5', gain: 0.55,
  },
  {
    id: 'bell', name: 'Keys · FM bell', kind: 'keys',
    equation: 'sin(TAU*f*tau + index*exp(-tau*2)*sin(TAU*f*ratio*tau)) * exp(-tau*decay)',
    params: { ratio: P(3.5, 0.5, 8), index: P(2.5, 0, 8), decay: P(3, 0.5, 10) },
    pattern: 'E5 . . G5 . . C6 . . . B5 . G5 . . .', echo: 0.35, gain: 0.45,
  },
  {
    id: 'lead', name: 'Lead · vibrato square', kind: 'keys',
    equation: 'sqr(f*tau + vib*sin(TAU*6*tau), width) * ad(tau, 0.01, decay)',
    params: { vib: P(0.15, 0, 1), width: P(0.5, 0.1, 0.9), decay: P(1.5, 0.2, 6) },
    pattern: 'C5 . . . E5 . G5 . A5 . . . G5 . E5 .', lp: 3000, gain: 0.35,
  },
  {
    id: 'chip', name: 'Lead · chiptune arp', kind: 'keys',
    equation: 'sqr(f*tau, duty) * exp(-tau*decay)',
    params: { duty: P(0.25, 0.1, 0.5), decay: P(6, 1, 30) },
    pattern: 'C5 E5 G5 C6 G5 E5 C5 E5 A4 C5 E5 A5 E5 C5 A4 C5', gain: 0.3,
  },
  {
    id: 'lofikeys', name: 'Keys · lo-fi tri', kind: 'keys',
    equation: 'tri(f*tau + wobble*sin(TAU*0.7*t)) * exp(-tau*decay)',
    params: { wobble: P(0.01, 0, 0.08), decay: P(1.2, 0.3, 5) },
    pattern: 'A3+C4+E4 . . . . . . . F3+A3+C4 . . . . . . .', rate: 2, lp: 2200, gain: 0.5,
  },

  // --- Pads ---
  {
    id: 'supersaw', name: 'Pad · supersaw', kind: 'pads',
    equation: '(saw(f*tau*(1 - spread)) + saw(f*tau) + saw(f*tau*(1 + spread))) / 3 * min(1, tau/attack)',
    params: { spread: P(0.006, 0, 0.03), attack: P(0.4, 0.01, 2) },
    pattern: 'C4+E4+G4 A3+C4+E4 F3+A3+C4 G3+B3+D4', rate: 0.25, lp: 1800, gain: 0.45,
  },
  {
    id: 'choir', name: 'Pad · sine choir', kind: 'pads',
    equation: '(sin(TAU*f*tau) + 0.5*sin(TAU*2.003*f*tau) + 0.25*sin(TAU*3*f*tau)) / 1.75 * min(1, tau/attack) * (1 - depth + depth*sin(TAU*0.5*t))',
    params: { attack: P(0.6, 0.01, 3), depth: P(0.2, 0, 0.8) },
    pattern: 'C4+E4+G4 A3+C4+E4 F3+A3+C4 G3+B3+D4', rate: 0.25, gain: 0.5,
  },

  // --- FX ---
  {
    id: 'riser', name: 'FX · noise riser', kind: 'fx',
    equation: 'noise() * min(1, tau/rise)^3',
    params: { rise: P(1, 0.2, 4) },
    pattern: '', hp: 2000, len: 1, gain: 0.35,
  },
  {
    id: 'whoosh', name: 'FX · whoosh', kind: 'fx',
    equation: 'noise() * (tau < rise ? (tau/rise)^2 : exp(-(tau - rise)*12))',
    params: { rise: P(0.38, 0.05, 2) },
    pattern: '', lp: 2600, len: 0.8, gain: 0.5,
  },
  {
    id: 'pop', name: 'FX · bubble pop', kind: 'fx',
    equation: 'sin(TAU*(lo*tau + (hi - lo)*(1 - exp(-tau*k))/k)) * exp(-tau*decay)',
    params: { hi: P(1100, 200, 3000), lo: P(380, 50, 1500), k: P(45, 5, 120), decay: P(35, 5, 100) },
    pattern: '', len: 0.15, gain: 0.45,
  },
  {
    id: 'splat', name: 'FX · paint splat', kind: 'fx',
    equation: 'sin(TAU*(60*tau + 90*(1 - exp(-tau*30))/30)) * exp(-tau*9) * 0.8 + noise() * exp(-tau*14) * wet',
    params: { wet: P(0.5, 0, 1) },
    pattern: '', lp: 1800, len: 0.45, gain: 0.6,
  },
  {
    id: 'click', name: 'FX · key click', kind: 'fx',
    equation: 'noise() * exp(-tau*decay)',
    params: { decay: P(300, 50, 800) },
    pattern: '', hp: 1500, len: 0.03, gain: 0.35,
  },
  {
    id: 'laser', name: 'FX · laser zap', kind: 'fx',
    equation: 'sqr(hi*tau - (hi - lo)*tau^2*speed/2, 0.5) * exp(-tau*decay)',
    params: { hi: P(1800, 300, 4000), lo: P(200, 50, 1000), speed: P(6, 1, 20), decay: P(10, 2, 40) },
    pattern: '', len: 0.3, gain: 0.25,
  },
];

export const byId = Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i]));

/** A track from an instrument, with optional overrides. Params become plain numbers. */
export function track(id, overrides = {}) {
  const inst = byId[id];
  const { params: pOver = {}, ...rest } = overrides;
  const params = {};
  for (const [k, v] of Object.entries(inst.params)) params[k] = pOver[k] ?? v.value;
  const { id: _id, name, kind, params: _p, ...defaults } = inst;
  return { name, instrument: id, ...defaults, params, ...rest };
}

const CHORDS = {
  C: ['C4', 'E4', 'G4'], Am: ['A3', 'C4', 'E4'], F: ['F3', 'A3', 'C4'], G: ['G3', 'B3', 'D4'],
  Dm: ['D4', 'F4', 'A4'], Em: ['E3', 'G3', 'B3'],
};
const up = (n, oct) => n.replace(/(-?\d)$/, (d) => String(Number(d) + oct));

/** 16th-note arpeggio over chords, one chord per bar. */
export function arp(chords, octave = 1) {
  return chords.map((c) => {
    const [a, b, d] = CHORDS[c].map((n) => up(n, octave));
    return [a, b, d, b, a, b, d, up(a, 1), a, b, d, b, a, b, d, up(b, 1)].join(' ');
  }).join(' ');
}
export const chords = (list, octave = 0) => list.map((c) => CHORDS[c].map((n) => up(n, octave)).join('+')).join(' ');
export const roots = (list, octave = -2) => list.map((c) => up(CHORDS[c][0], octave)).join(' ');
/** One bar per chord, bass root on a rhythm like '. . x .' (x = root), repeated to 16 steps. */
export function bassline(list, rhythm, octave = -2) {
  const cells = rhythm.split(/\s+/);
  return list.map((c) => {
    const r = up(CHORDS[c][0], octave);
    return Array.from({ length: 16 }, (_, k) => (cells[k % cells.length] === 'x' ? r : '.')).join(' ');
  }).join(' ');
}

export const SONGS = {
  house: {
    title: 'Four on the floor', bpm: 124, bars: 4,
    tracks: [
      track('kick'),
      track('clap'),
      track('hat', { pattern: '..x...x...x...x.', params: { decay: 30 } }),
      track('shaker', { gain: 0.18 }),
      track('sawbass', { pattern: bassline(['C', 'Am', 'F', 'G'], '. . x .') }),
      track('pluck', { pattern: arp(['C', 'Am', 'F', 'G']), pan: 0.2, echo: 0.25 }),
      track('supersaw', { pattern: chords(['C', 'Am', 'F', 'G']) }),
    ],
  },
  lofi: {
    title: 'Lo-fi homework', bpm: 84, bars: 4,
    tracks: [
      track('kick', { pattern: 'x.....x...x.....', params: { decay: 9, punch: 90 } }),
      track('snare', { pattern: '....x.......x...', params: { tone: 0.5, decay: 12 }, lp: 4000 }),
      track('hat', { pattern: 'x.x.x.x.x.x.x.xx', gain: 0.25, params: { decay: 70 } }),
      track('lofikeys', { pattern: chords(['Am', 'F', 'C', 'G']).split(' ').map((c) => `${c} . . . . . . .`).join(' '), rate: 2 }),
      track('sub', { pattern: roots(['Am', 'F', 'C', 'G']).split(' ').map((n) => `${n} . . . . . . . . . . . . . . .`).join(' ') }),
      track('bell', { pattern: 'E5 . . . . . G5 . . . . . C6 . . . . . . . B5 . . . . . . . . . . .', gain: 0.25 }),
    ],
  },
  chip: {
    title: 'Level 1-1', bpm: 140, bars: 4,
    tracks: [
      track('kick', { pattern: 'x.......x.x.....', params: { decay: 12 } }),
      track('snare', { pattern: '....x.......x...', params: { tone: 0.2, decay: 25 } }),
      track('chip', { pattern: arp(['C', 'G', 'Am', 'F']) }),
      track('lead', { pattern: 'C5 . . . G5 . . . E5 . . . . . . . D5 . . . B4 . . . G4 . . . . . . . A4 . . . C5 . . . E5 . . . . . . . F5 . . . E5 . . . C5 . . . . . . .', gain: 0.3 }),
      track('sawbass', { pattern: bassline(['C', 'G', 'Am', 'F'], 'x .'), lp: 900 }),
    ],
  },
};
