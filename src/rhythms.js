// Rhythms from math: each generator returns an array of booleans, one per step (true = hit).
//
//   euclid(3, 8)         -> x..x..x.          (the tresillo)
//   polyrhythm(3, 4, 12) -> x..xx.x.xx..     (3 against 4)
//   fibonacci(16)        -> xxx.x..x....x... (hits on steps 1, 2, 3, 5, 8, 13)
//
// toPattern() turns the booleans into a track pattern, keeping a melodic track's notes.

import { compile } from './equalizer.js';

const clampInt = (v, lo, hi, fallback) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : fallback);
const rotate = (hits, by) => {
  const n = hits.length, k = ((Math.round(by) % n) + n) % n;
  return hits.map((_, i) => hits[(i - k + n) % n]);
};

/** Euclidean rhythm E(k, n): k hits spread as evenly as possible over n steps. */
export function euclid(k, n) {
  n = clampInt(n, 1, 64, 8); k = clampInt(k, 0, n, 3);
  return Array.from({ length: n }, (_, i) => (i * k) % n < k);
}

/** a evenly spaced pulses against b evenly spaced pulses, over n steps. */
export function polyrhythm(a, b, n) {
  n = clampInt(n, 2, 64, 12); a = clampInt(a, 1, n, 3); b = clampInt(b, 1, n, 4);
  const hits = new Array(n).fill(false);
  for (const m of [a, b]) for (let j = 0; j < m; j++) hits[Math.round((j * n) / m) % n] = true;
  return hits;
}

/** Hits on the Fibonacci-numbered steps: 1, 2, 3, 5, 8, 13, 21, ... */
export function fibonacci(n) {
  n = clampInt(n, 1, 64, 16);
  const hits = new Array(n).fill(false);
  for (let a = 1, b = 2; a <= n; [a, b] = [b, a + b]) hits[a - 1] = true;
  return hits;
}

/** Hits on the prime-numbered steps: 2, 3, 5, 7, 11, 13, ... */
export function primes(n) {
  n = clampInt(n, 1, 64, 16);
  const isPrime = (x) => { if (x < 2) return false; for (let d = 2; d * d <= x; d++) if (x % d === 0) return false; return true; };
  return Array.from({ length: n }, (_, i) => isPrime(i + 1));
}

/** The golden ratio's rhythm (the Fibonacci word): a hit wherever multiples of 1/φ cross a whole number. */
export function golden(n) {
  n = clampInt(n, 1, 64, 16);
  const g = 2 / (1 + Math.sqrt(5));
  return Array.from({ length: n }, (_, i) => Math.floor((i + 1) * g) > Math.floor(i * g));
}

/**
 * Your own rule: hit wherever the equation is true (non-zero). i is the step (0, 1, 2, ...),
 * n the number of steps; step, beat and bar work too. Throws EquationError if it doesn't parse.
 */
export function fromEquation(equation, n) {
  n = clampInt(n, 1, 64, 16);
  const fn = compile(equation, ['i', 'n']);
  return Array.from({ length: n }, (_, i) => {
    const v = fn(0, 0, 0, i / 4, i, Math.floor(i / 16), 0, 120, i, n);
    return v === true || (typeof v === 'number' && Number.isFinite(v) && v !== 0);
  });
}

/** Every generator, with the inputs a UI needs to offer. */
export const RHYTHMS = {
  euclid: { label: 'Euclidean E(k, n)', inputs: { k: ['hits', 3, 0, 64], n: ['steps', 8, 1, 64] }, make: ({ k, n }) => euclid(k, n) },
  polyrhythm: { label: 'Polyrhythm a : b', inputs: { a: ['a', 3, 1, 16], b: ['b', 4, 1, 16], n: ['steps', 12, 2, 64] }, make: ({ a, b, n }) => polyrhythm(a, b, n) },
  fibonacci: { label: 'Fibonacci steps', inputs: { n: ['steps', 16, 1, 64] }, make: ({ n }) => fibonacci(n) },
  primes: { label: 'Prime steps', inputs: { n: ['steps', 16, 1, 64] }, make: ({ n }) => primes(n) },
  golden: { label: 'Golden ratio', inputs: { n: ['steps', 16, 1, 64] }, make: ({ n }) => golden(n) },
  equation: { label: 'Your own rule', inputs: { n: ['steps', 16, 1, 64] }, make: ({ n, equation }) => fromEquation(equation || 'i % 3 == 0', n) },
};

/** One-click presets: famous rhythms and fun math ones. */
export const RHYTHM_PRESETS = [
  ['Tresillo', 'euclid', { k: 3, n: 8 }],
  ['Cinquillo', 'euclid', { k: 5, n: 8, rotate: 6 }],
  ['Bossa', 'euclid', { k: 5, n: 16 }],
  ['Samba', 'euclid', { k: 7, n: 16 }],
  ['Bembé bell', 'euclid', { k: 7, n: 12, rotate: 5 }],
  ['3 : 4', 'polyrhythm', { a: 3, b: 4, n: 12 }],
  ['Fibonacci', 'fibonacci', { n: 16 }],
  ['Primes', 'primes', { n: 16 }],
  ['Golden', 'golden', { n: 16 }],
];

/** Make a rhythm by name. opts: the generator's inputs plus rotate (shift later by that many steps). */
export function makeRhythm(kind, opts = {}) {
  const gen = RHYTHMS[kind];
  if (!gen) throw new Error(`Unknown rhythm "${kind}"`);
  const hits = gen.make(opts);
  return opts.rotate ? rotate(hits, opts.rotate) : hits;
}

/**
 * Turn hits into a pattern string. For a melodic track pass its notes (in order); they're reused
 * on the hits, cycling. Without notes you get a drum pattern like "x..x..x.".
 */
export function toPattern(hits, notes = null) {
  if (!notes?.length) return hits.map((h) => (h ? 'x' : '.')).join('');
  let j = 0;
  return hits.map((h) => (h ? notes[j++ % notes.length] : '.')).join(' ');
}
