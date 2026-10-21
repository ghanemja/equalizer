import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compile, EquationError, isParamName, noteToFreq, parsePattern, renderSong, renderTrack, toWav, triggers, songDuration,
} from '../src/equalizer.js';
import { INSTRUMENTS, SONGS, track } from '../src/presets.js';

const call = (eq, vars = {}, params = {}) => {
  const fn = compile(eq, Object.keys(params));
  const v = { t: 0, tau: 0, f: 440, beat: 0, step: 0, bar: 0, r: 0, bpm: 120, ...vars };
  return fn(v.t, v.tau, v.f, v.beat, v.step, v.bar, v.r, v.bpm, ...Object.values(params));
};

test('evaluates math with the usual precedence', () => {
  assert.equal(call('1 + 2 * 3'), 7);
  assert.equal(call('2 ^ 3 ^ 2'), 512);          // right-associative
  assert.equal(call('-2 ^ 2'), -4);              // unary minus binds looser than ^
  assert.equal(call('(1 + 2) * 3'), 9);
  assert.equal(call('tau > 0.5 ? 1 : 2', { tau: 0.7 }), 1);
  assert.equal(call('1 == 1'), true);
  assert.ok(Math.abs(call('sin(TAU * f * tau)', { tau: 1 / 1760 }) - 1) < 1e-9);
  assert.equal(call('decay * 2', {}, { decay: 4 }), 8);
});

test('oscillators take a phase in cycles', () => {
  assert.equal(call('saw(0.25)'), -0.5);
  assert.equal(call('sqr(0.25)'), 1);
  assert.equal(call('sqr(0.75)'), -1);
  assert.equal(call('tri(0)'), 0);
  assert.equal(call('tri(0.25)'), 1);
});

test('rejects anything that is not math', () => {
  const bad = [
    'alert(1)', 'constructor', 'this', 'globalThis', 'window.location', 'f["x"]', '"str"', 'tau = 1',
    'process.exit()', '(() => 1)()', 'a; b', '`x`', 'sin', 'Function("x")', '__proto__', 'f.constructor',
    'new Date()', 'x => x', '1 +', '(1', 'tau tau', 'toString()', 'valueOf()', 'hasOwnProperty(1)',
    'constructor(1)', '__defineGetter__(1)', 'isPrototypeOf(1)',
  ];
  for (const eq of bad) assert.throws(() => compile(eq), EquationError, eq);
});

test('validates parameter names', () => {
  assert.ok(isParamName('decay'));
  for (const n of ['sin', 'tau', 'PI', 'return', 'constructor', 'a-b', '1x', 'x y', '', 'a'.repeat(40)]) assert.ok(!isParamName(n), n);
  assert.throws(() => compile('1', ['return']), EquationError);
});

test('gives readable errors', () => {
  assert.throws(() => compile('sin(tau'), /Expected "\)"/);
  assert.throws(() => compile('foo * 2'), /Unknown name "foo"/);
  assert.throws(() => compile('bar2(1)'), /Unknown function "bar2"/);
});

test('notes and patterns', () => {
  assert.equal(noteToFreq('A4'), 440);
  assert.ok(Math.abs(noteToFreq('C4') - 261.6256) < 1e-3);
  assert.ok(Math.abs(noteToFreq('Eb2') - noteToFreq('D#2')) < 1e-9);
  assert.equal(noteToFreq('H2'), null);
  assert.deepEqual(parsePattern('x.-').map((s) => [!!s.hit, !!s.stop]), [[true, false], [false, false], [false, true]]);
  const chord = parsePattern('C4+E4+G4 .');
  assert.equal(chord[0].notes.length, 3);
  assert.throws(() => parsePattern('C4 Q9'), EquationError);
});

test('triggers follow the pattern, the gate and absolute times', () => {
  const song = { bpm: 120 };
  const hits = triggers({ pattern: 'x...', gate: 't >= 1' }, song, 2);
  assert.deepEqual(hits.map((h) => h.time), [1, 1.5]);
  const at = triggers({ pattern: '', at: [0.3, 1.2], len: 0.1 }, song, 2);
  assert.deepEqual(at.map((h) => [h.time, +h.end.toFixed(3)]), [[0.3, 0.4], [1.2, 1.3]]);
});

test('renders deterministically, including noise', () => {
  const song = { bpm: 120, bars: 1, tracks: [track('hat'), track('kick')] };
  const a = renderSong(song, { sampleRate: 8000 });
  const b = renderSong(song, { sampleRate: 8000 });
  assert.equal(a.left.length, 8000 * 2);
  assert.deepEqual(a.left, b.left);
  const peak = a.left.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(peak > 0.85 && peak < 0.9, `peak ${peak}`);
});

test('mute and solo', () => {
  const kick = track('kick');
  const silent = renderSong({ bars: 1, tracks: [{ ...kick, mute: true }] }, { sampleRate: 8000 });
  assert.ok(silent.left.every((v) => v === 0));
  const solo = renderSong({ bars: 1, tracks: [{ ...kick, solo: true }, track('hat')] }, { sampleRate: 8000, normalize: false });
  const kickOnly = renderSong({ bars: 1, tracks: [kick] }, { sampleRate: 8000, normalize: false });
  assert.deepEqual(solo.left, kickOnly.left);
});

test('writes a valid WAV header', () => {
  const wav = toWav(new Float32Array([0, 1, -1]), new Float32Array([0, 0.5, -0.5]), 44100);
  const text = (o) => String.fromCharCode(...wav.slice(o, o + 4));
  assert.equal(text(0), 'RIFF');
  assert.equal(text(8), 'WAVE');
  assert.equal(wav.length, 44 + 3 * 4);
  const view = new DataView(wav.buffer);
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getInt16(48, true), 32767);
});

test('every built-in instrument compiles and makes sound', () => {
  for (const inst of INSTRUMENTS) {
    const t = track(inst.id, { at: [0], pattern: inst.pattern || '' });
    const buf = renderTrack(t, { bpm: 120 }, { sampleRate: 8000, duration: 1 });
    const energy = buf.reduce((s, v) => s + v * v, 0);
    assert.ok(energy > 0, `${inst.id} is silent`);
    assert.ok(buf.every(Number.isFinite), `${inst.id} produced NaN`);
  }
});

test('every example song renders', () => {
  for (const [id, song] of Object.entries(SONGS)) {
    const out = renderSong(song, { sampleRate: 8000 });
    assert.equal(out.left.length, Math.ceil(songDuration(song) * 8000), id);
  }
});

test('readMath turns everyday math into equations that compile', async () => {
  const { readMath } = await import('../src/mathinput.js');
  const cases = {
    'y = e^{-3t} \\sin(2\\pi f t)': 'E^(-3*tau)*sin(2*PI*f*tau)',
    'sin(2πft)·e^(−4x)': 'sin(2*PI*f*tau)*E^(-4*tau)',
    'f(t) = |sin(2πft)|·exp(-5t)': 'abs(sin(2*PI*f*tau))*exp(-5*tau)',
    'x²·e^(-x)': 'tau^(2)*E^(-tau)',
    'sin 2πft': 'sin(2*PI*f*tau)',
    '0.5sin(2πft)+0.5saw(ft)': '0.5*sin(2*PI*f*tau) + 0.5*saw(f*tau)',
    '\\frac{\\sin(4\\pi f t)}{4}': '((sin(4*PI*f*tau))/(4))',
  };
  for (const [input, want] of Object.entries(cases)) {
    const { equation } = readMath(input);
    assert.equal(equation, want, input);
    assert.doesNotThrow(() => compile(equation), input);
  }
  // Already-valid equations keep t (song time) when tau is also used, and knob names aren't split.
  assert.equal(readMath('sin(TAU*f*tau)*sin(TAU*0.5*t)').equation, 'sin(TAU*f*tau)*sin(TAU*0.5*t)');
  assert.equal(readMath('exp(-tau*ft)', ['ft']).equation, 'exp(-tau*ft)');
  // It only rewrites text: anything unsafe is still rejected by compile().
  assert.throws(() => compile(readMath('constructor.constructor("alert(1)")()').equation), EquationError);
});

test('math rhythms', async () => {
  const { makeRhythm, toPattern, fromEquation } = await import('../src/rhythms.js');
  const p = (kind, opts) => toPattern(makeRhythm(kind, opts));
  assert.equal(p('euclid', { k: 3, n: 8 }), 'x..x..x.');
  assert.equal(p('euclid', { k: 5, n: 8, rotate: 6 }), 'x.xx.xx.');
  assert.equal(p('euclid', { k: 3, n: 8, rotate: 1 }), '.x..x..x');
  assert.equal(p('polyrhythm', { a: 3, b: 4, n: 12 }), 'x..xx.x.xx..');
  assert.equal(p('fibonacci', { n: 16 }), 'xxx.x..x....x...');
  assert.equal(p('primes', { n: 16 }), '.xx.x.x...x.x...');
  assert.equal(toPattern(fromEquation('i % 4 == 0', 8)), 'x...x...');
  assert.equal(toPattern(makeRhythm('euclid', { k: 3, n: 8 }), ['C3', 'E3']), 'C3 . . E3 . . C3 .');
  assert.throws(() => fromEquation('i.constructor', 8), EquationError);
});

test('beats per bar sets the bar length and the bar variable', async () => {
  const { songDuration, beatsPerBar, triggers } = await import('../src/equalizer.js');
  assert.equal(songDuration({ bpm: 120, bars: 4 }), 8);
  assert.equal(songDuration({ bpm: 120, bars: 4, beatsPerBar: 3 }), 6);
  assert.equal(beatsPerBar({ beatsPerBar: 7 }), 7);
  assert.equal(beatsPerBar({ beatsPerBar: 'nope' }), 4);
  // A gate on "bar" counts bars of 3 beats: in 3/4 at 60 bpm, bar 1 starts at 3 s.
  const song = { bpm: 60, bars: 2, beatsPerBar: 3 };
  const hits = triggers({ pattern: 'x', rate: 1, gate: 'bar == 1' }, song, songDuration(song)).map((h) => h.time);
  assert.deepEqual(hits, [3, 4, 5]);
});
