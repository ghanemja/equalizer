import {
  compile, EquationError, isParamName, noteToFreq, parsePattern, paramValues, renderSong, toWav, Player, VARIABLES, FUNCTIONS, CONSTANTS,
  triggers, songDuration,
} from './src/equalizer.js?v=dev';
import { INSTRUMENTS, SONGS, byId, track as makeTrack } from './src/presets.js?v=dev';

const $ = (sel, el = document) => el.querySelector(sel);
const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else if (v !== undefined && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.filter((k) => k != null));
  return el;
};

const player = new Player();
const KINDS = { drums: 'Drums', bass: 'Bass', keys: 'Keys & leads', pads: 'Pads', fx: 'FX' };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const RATES = { 4: '1/16 note', 2: '1/8 note', 1: '1/4 note (beat)', 0.25: 'Whole bar' };
let song;
let selected = 0;        // selected track index
let picked = null;       // { track, token } picked step in a note row
let rows = [];           // per track: { el, cells, vu, track }
let stemIndex = [];      // song track index -> index in rendered stems
let plots = [];          // math monitor: per track { el, canvas, label, cache }
let triggerCache = null; // per track: when it fires in the loop

// --- Song state ---------------------------------------------------------------------

const num = (v, lo, hi, d) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, +v)) : d);
const str = (v, max, d = '') => (typeof v === 'string' ? v.slice(0, max) : d);

/** Copy a song from an untrusted source (share link, storage) keeping only known, bounded fields. */
function sanitize(raw) {
  const s = { title: str(raw?.title, 60, 'Untitled'), bpm: num(raw?.bpm, 40, 220, 120), bars: [1, 2, 4, 8].includes(+raw?.bars) ? +raw.bars : 4, tracks: [] };
  for (const t of Array.isArray(raw?.tracks) ? raw.tracks.slice(0, 16) : []) {
    const params = {};
    for (const [k, v] of Object.entries(t?.params ?? {})) {
      if (isParamName(k) && Object.keys(params).length < 12) params[k] = num(typeof v === 'object' ? v?.value : v, -1e5, 1e5, 0);
    }
    const ranges = {};
    for (const [k, r] of Object.entries(t?.ranges ?? {})) {
      if (Object.hasOwn(params, k) && Array.isArray(r)) ranges[k] = [num(r[0], -1e5, 1e5, 0), num(r[1], -1e5, 1e5, 1)];
    }
    s.tracks.push({
      name: str(t?.name, 24, 'Sound'),
      instrument: Object.hasOwn(byId, t?.instrument) ? t.instrument : undefined,
      equation: str(t?.equation, 2000, '0'),
      params, ranges,
      pattern: str(t?.pattern, 800),
      rate: [4, 2, 1, 0.25].includes(+t?.rate) ? +t.rate : 4,
      note: noteToFreq(str(t?.note, 4)) ? t.note : undefined,
      gain: num(t?.gain, 0, 2.5, 0.7), pan: num(t?.pan, -1, 1, 0),
      lp: num(t?.lp, 0, 20000, 0), hp: num(t?.hp, 0, 20000, 0),
      echo: num(t?.echo, 0, 0.9, 0), echoTime: num(t?.echoTime, 0.0625, 4, 0.75),
      len: t?.len == null ? undefined : num(t.len, 0.005, 16, 1),
      gate: t?.gate ? str(t.gate, 300) : undefined,
      at: Array.isArray(t?.at) ? t.at.slice(0, 256).map((x) => num(x, 0, 600, 0)) : undefined,
      mute: !!t?.mute, solo: !!t?.solo,
    });
  }
  return s;
}

const kindOf = (t) => byId[t.instrument]?.kind ?? 'keys';
const soundName = (t) => byId[t.instrument]?.name ?? 'Custom equation';

function rangeOf(t, k) {
  const r = t.ranges?.[k] ?? (byId[t.instrument]?.params[k] && [byId[t.instrument].params[k].min, byId[t.instrument].params[k].max]);
  if (r) return r;
  const v = Math.abs(t.params[k]) || 1;
  return [0, Math.max(1, v * 2)];
}

/** The equation error for a track, or null if it can play. */
function problem(t) {
  try {
    compile(t.equation, Object.keys(t.params));
    parsePattern(t.pattern);
    if (t.gate) compile(t.gate);
    return null;
  } catch (e) {
    if (e instanceof EquationError) return e.message;
    throw e;
  }
}

/** The song minus sounds whose equations don't compile, so a typo never stops the music. */
function playable() {
  stemIndex = [];
  const tracks = [];
  song.tracks.forEach((t, i) => { if (!problem(t)) { stemIndex[i] = tracks.length; tracks.push(t); } });
  return { ...song, tracks };
}

let renderTimer;
function changed({ now = false } = {}) {
  triggerCache = null;
  clearTimeout(renderTimer);
  const go = () => {
    try { localStorage.setItem('eq-song-v2', JSON.stringify(song)); } catch {}
    if (player.playing) player.update(playable());
  };
  if (now) go(); else renderTimer = setTimeout(go, 140);
}

// --- Patterns -----------------------------------------------------------------------

const isNote = (tok) => tok !== '.' && tok !== '_' && tok !== '-' && tok.toLowerCase() !== 'x';
const isHit = (tok) => tok.toLowerCase() === 'x' || isNote(tok);
const isMelodic = (t) => !!(t.pattern ?? '').trim() && /\s/.test(t.pattern.trim());

function tokensOf(t) {
  const p = (t.pattern ?? '').trim();
  if (!p) return { compact: true, toks: Array(16).fill('.') };
  return /\s/.test(p) ? { compact: false, toks: p.split(/\s+/) } : { compact: true, toks: [...p.replace(/\|/g, '')] };
}
function setTokens(t, compact, toks) {
  t.pattern = toks.join(compact ? '' : ' ');
}
function transpose(tok, semis) {
  return tok.split('+').map((n) => {
    const f = noteToFreq(n);
    if (!f) return n;
    const midi = Math.round(69 + 12 * Math.log2(f / 440)) + semis;
    if (midi < 12 || midi > 120) return n;
    return NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
  }).join('+');
}
const noteLabel = (tok) => (isNote(tok) ? tok.split('+')[0] + (tok.includes('+') ? '+' : '') : '');

// --- Knobs --------------------------------------------------------------------------

const fmt = (v) => {
  const a = Math.abs(v);
  if (a >= 1000) return `${(v / 1000).toFixed(a >= 10000 ? 0 : 1)}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(3);
};

/**
 * A rotary knob. Drag up/down (shift for fine), scroll, or use arrow keys.
 * Double-click resets. scale: 'lin' | 'log' | 'off-log' (0 = off, then log).
 */
function knob({ label, min, max, value, scale = 'lin', reset = value, format = fmt, onInput, title }) {
  const el = h('div', { class: 'knob', tabindex: 0, role: 'slider', 'aria-label': label, title: title ?? `${label}: drag up/down, double-click to reset` });
  const val = h('div', { class: 'knob-value' });
  const wrap = h('div', { class: 'knob-wrap' }, el, val, h('div', { class: 'knob-label', text: label }));
  const logOk = min > 0 && max / min > 1;
  const toN = (v) => {
    if (scale === 'off-log') return v <= 0 ? 0 : 0.04 + 0.96 * Math.log(v / min) / Math.log(max / min);
    if (scale === 'log' && logOk) return Math.log(Math.max(v, min) / min) / Math.log(max / min);
    return (v - min) / (max - min || 1);
  };
  const fromN = (n) => {
    if (scale === 'off-log') return n < 0.04 ? 0 : min * (max / min) ** ((n - 0.04) / 0.96);
    if (scale === 'log' && logOk) return min * (max / min) ** n;
    return min + (max - min) * n;
  };
  let n = Math.min(1, Math.max(0, toN(value)));
  const show = (v) => {
    el.style.setProperty('--v', n.toFixed(4));
    val.textContent = format(v);
    el.setAttribute('aria-valuenow', String(+v.toPrecision(4)));
    el.setAttribute('aria-valuetext', format(v));
  };
  const set = (next) => {
    n = Math.min(1, Math.max(0, next));
    const v = +fromN(n).toPrecision(4);
    show(v);
    onInput(v);
  };
  show(value);
  let startY = 0, startN = 0;
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); startY = e.clientY; startN = n; el.focus(); });
  el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) set(startN + (startY - e.clientY) / (e.shiftKey ? 600 : 150)); });
  el.addEventListener('wheel', (e) => { e.preventDefault(); set(n - Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.03)); }, { passive: false });
  el.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const map = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: 0.1, PageDown: -0.1 };
    if (e.key in map) { e.preventDefault(); set(n + map[e.key]); }
    if (e.key === 'Home') { e.preventDefault(); set(0); }
    if (e.key === 'End') { e.preventDefault(); set(1); }
  });
  el.addEventListener('dblclick', () => set(toN(reset)));
  return wrap;
}

// --- Waveform preview ---------------------------------------------------------------

function voiceSamples(t, count, seconds) {
  const fn = compile(t.equation, Object.keys(t.params));
  const pv = Object.values(paramValues(t.params));
  const first = tokensOf(t).toks.find(isNote);
  const f = (first && noteToFreq(first.split('+')[0])) || noteToFreq(t.note ?? 'A2');
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const tau = (i / count) * seconds;
    const v = fn(tau, tau, f, tau * song.bpm / 60, 0, 0, 0.5, song.bpm, ...pv);
    out[i] = Number.isFinite(v) ? Math.max(-1.2, Math.min(1.2, v)) : 0;
  }
  return out;
}

function drawWave(canvas, t) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.clientWidth * dpr || 600;
  canvas.height = canvas.clientHeight * dpr || 140;
  const g = canvas.getContext('2d');
  const { width: w, height: hgt } = canvas;
  g.clearRect(0, 0, w, hgt);
  const color = getComputedStyle(canvas).getPropertyValue('--c').trim() || '#00e5ff';
  g.strokeStyle = '#1d1d28';
  g.beginPath(); g.moveTo(0, hgt / 2); g.lineTo(w, hgt / 2); g.stroke();
  if (problem(t)) return;
  const secs = { drums: 0.5, fx: 0.5, bass: 0.8, keys: 1, pads: 1.5 }[kindOf(t)];
  const per = 6;
  const s = voiceSamples(t, w * per, secs);
  g.fillStyle = color;
  g.shadowColor = color;
  g.shadowBlur = 6;
  for (let x = 0; x < w; x++) {
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < per; k++) { const v = s[x * per + k]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const y1 = hgt / 2 - hi * hgt * 0.42, y2 = hgt / 2 - lo * hgt * 0.42;
    g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
}

// --- The step grid ------------------------------------------------------------------

const COLS_PER_BAR = 16;
const totalCols = () => song.bars * COLS_PER_BAR;

function instrumentSelect(t, onChange) {
  const sel = h('select', { 'aria-label': 'Sound' });
  if (t && !t.instrument) sel.add(new Option('Custom equation', ''));
  for (const [kind, label] of Object.entries(KINDS)) {
    const group = h('optgroup', { label });
    for (const inst of INSTRUMENTS.filter((i) => i.kind === kind)) group.append(new Option(inst.name, inst.id));
    sel.append(group);
  }
  sel.value = t?.instrument ?? '';
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function buildGrid() {
  const grid = $('#grid');
  grid.textContent = '';
  grid.style.setProperty('--cols', totalCols());

  // ruler
  const rulerCells = h('div', { class: 'cells' });
  for (let b = 0; b < song.bars; b++) {
    rulerCells.append(h('div', { class: 'bar', style: `grid-column: ${b * 16 + 1} / span 4`, text: `${b + 1}` }));
    for (let beat = 1; beat < 4; beat++) rulerCells.append(h('div', { class: 'beat', style: `grid-column: ${b * 16 + beat * 4 + 1} / span 4` }));
  }
  grid.append(h('div', { class: 'row ruler' }, h('div', { class: 'head', text: 'Sounds' }), rulerCells, h('div', { class: 'tail', text: 'Volume' })));

  rows = song.tracks.map((t, i) => buildRow(t, i));
  for (const r of rows) grid.append(r.el);
  paintSilenced();

  // add a sound
  const add = instrumentSelect(null, (id) => {
    if (!id) return;
    const t = makeTrack(id);
    if (!t.pattern) t.pattern = 'x...............';
    song.tracks.push(t);
    select(song.tracks.length - 1);
    buildGrid(); changed({ now: true });
  });
  add.prepend(new Option('+ Add a sound…', ''));
  add.value = '';
  if (song.tracks.length < 16) {
    grid.append(h('div', { class: 'row add-row' }, h('div', { class: 'head' }, add), h('div', { class: 'hint', text: 'Every sound is an equation. Pick one to add a row.' }), h('div')));
  }
  grid.append(h('div', { class: 'playhead', id: 'playhead' }));
  buildMonitor();
  markSelected();
}

const svgIcon = (body) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const SPEAKER = '<path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/>';
const ICONS = {
  sound: svgIcon(SPEAKER + '<path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  // The same speaker with its waves, struck through.
  muted: svgIcon(SPEAKER + '<path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" opacity=".35"/><path d="M3 3l18 18" stroke-width="2.4"/>'),
};

/** While any sound is soloed, dim the rows you can't hear. */
function paintSilenced() {
  const soloing = song.tracks.some((t) => t.solo);
  for (const r of rows) r.el.classList.toggle('silenced', soloing && !r.track.solo);
}

function buildRow(t, i) {
  const kind = kindOf(t);
  const el = h('div', { class: `row track${t.mute ? ' muted' : ''}`, 'data-kind': kind });
  const name = h('button', { class: 'row-name', title: 'Edit this sound', 'aria-label': `Select ${t.name}`, onclick: () => select(i) },
    t.name, h('small', { text: soundName(t).replace(/^.*? · /, '') }));
  const mute = h('button', { class: 'chip mute', 'aria-label': `Mute ${t.name}` });
  const paintMute = () => {
    mute.classList.toggle('on', !!t.mute);
    mute.setAttribute('aria-pressed', String(!!t.mute));
    mute.title = t.mute ? 'Muted: click to unmute' : 'Click to mute';
    mute.innerHTML = t.mute ? ICONS.muted : ICONS.sound;
  };
  paintMute();
  mute.addEventListener('click', () => { t.mute = !t.mute; paintMute(); el.classList.toggle('muted', t.mute); plots[i]?.el.classList.toggle('muted', t.mute); changed({ now: true }); });
  const del = h('button', { class: 'chip del', title: `Remove ${t.name}`, 'aria-label': `Remove ${t.name}`, text: '×', onclick: () => removeTrack(i) });

  const cells = h('div', { class: 'cells' });
  const gain = h('input', { type: 'range', min: 0, max: 2.5, step: 0.01, value: t.gain ?? 0.8, 'aria-label': `${t.name} volume` });
  const gainTitle = () => { gain.title = `Volume ${Math.round(+gain.value * 100)}%`; };
  gainTitle();
  gain.addEventListener('input', () => { t.gain = +gain.value; gainTitle(); changed(); });
  const vu = h('i');
  el.append(h('div', { class: 'head' }, h('span', { class: 'dot' }), name, mute, del), cells, h('div', { class: 'tail' }, gain, h('div', { class: 'vu' }, vu)));
  const row = { el, cells, vu, track: t, index: i };
  drawCells(row);
  return row;
}

/** Lay a track's pattern out across the whole loop. Repeats of the pattern are dimmed. */
function drawCells(row) {
  const t = row.track;
  row.cells.textContent = '';
  const { compact, toks } = tokensOf(t);
  const span = Math.max(1, Math.round(4 / (t.rate ?? 4)));
  const count = Math.max(1, Math.floor(totalCols() / span));
  row.span = span;
  row.cellEls = [];
  for (let c = 0; c < count; c++) {
    const k = c % toks.length;
    const tok = toks[k];
    const on = compact ? tok.toLowerCase() === 'x' : isHit(tok);
    const col = c * span;
    const classes = ['cell'];
    if (on) classes.push('on');
    if (c >= toks.length) classes.push('ghost');
    if (Math.floor(col / 4) % 2) classes.push('beat-b');
    if (picked && picked.track === t && picked.token === k && on) classes.push('picked');
    const label = !compact && on ? noteLabel(tok) : '';
    const cell = h('button', {
      class: classes.join(' '),
      style: `grid-column: ${col + 1} / span ${span}`,
      'aria-pressed': String(on),
      'aria-label': `${t.name}, bar ${Math.floor(col / 16) + 1} step ${(col % 16) + 1}${label ? `, ${tok}` : ''}`,
      title: label ? tok : undefined,
      text: span >= 2 || toks.length <= 16 ? label : '',
    });
    cell.addEventListener('click', () => clickCell(row, k));
    row.cells.append(cell);
    row.cellEls.push(cell);
  }
}

function clickCell(row, k) {
  const t = row.track;
  const cur = tokensOf(t);
  if (selected !== row.index) select(row.index);
  if (cur.compact) {
    cur.toks[k] = cur.toks[k].toLowerCase() === 'x' ? '.' : 'x';
    picked = null;
  } else if (isHit(cur.toks[k])) {
    // first click picks the note for editing, a second click removes it
    if (picked && picked.track === t && picked.token === k) { cur.toks[k] = '.'; picked = null; }
    else picked = { track: t, token: k };
  } else {
    cur.toks[k] = [...cur.toks.slice(0, k)].reverse().find(isNote) ?? cur.toks.find(isNote) ?? (kindOf(t) === 'bass' ? 'C2' : 'C4');
    picked = { track: t, token: k };
  }
  setTokens(t, cur.compact, cur.toks);
  drawCells(row);
  buildInspector();
  changed({ now: true });
}

function select(i) {
  if (i === selected && $('#inspector').childElementCount) return;
  selected = i;
  if (picked && picked.track !== song.tracks[i]) picked = null;
  markSelected();
  buildInspector();
  showSelected();
}

function markSelected() {
  rows.forEach((r, i) => r.el.classList.toggle('selected', i === selected));
  plots.forEach((p, i) => p.el.classList.toggle('selected', i === selected));
}

// --- Math monitor: every sound's equation, plotted and animated ---------------------

const PLOT_SECONDS = { drums: 0.5, fx: 0.5, bass: 0.5, keys: 0.5, pads: 2 };

function freqName(f) {
  const midi = Math.round(69 + 12 * Math.log2(f / 440));
  return NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}
function defaultFreq(t) {
  const first = tokensOf(t).toks.find(isNote);
  return (first && noteToFreq(first.split('+')[0])) || noteToFreq(t.note ?? 'A2');
}

function buildMonitor() {
  const box = $('#plots');
  box.textContent = '';
  plots = song.tracks.map((t, i) => {
    const label = h('span');
    const canvas = h('canvas', { 'aria-hidden': 'true' });
    const el = h('button', { class: `plot${t.mute ? ' muted' : ''}`, 'data-kind': kindOf(t), title: `Edit ${t.name}`, onclick: () => select(i) },
      h('div', { class: 'plot-top' }, h('span', { class: 'dot' }), h('b', { text: t.name }), label),
      h('div', { class: 'plot-eq' }, h('i', { text: 'f(τ)' }), ' = ', prettyEq(t.equation, t.params)),
      canvas);
    box.append(el);
    return { el, canvas, label, cache: null, track: t };
  });
}

// --- Math plots: graph paper, axes, ticks, labels, and the curve -------------------

const PLOT_PAD = { l: 30, r: 16, t: 14, b: 20 }; // CSS px around the plot area
const MATH_FONT = '"STIX Two Text", "Cambria Math", "Latin Modern Roman", "Times New Roman", serif';

/** Sample an equation over [0, secs) at one pitch. Returns null if it doesn't compile. */
function sampleCurve(equation, params, f, secs, n) {
  try {
    const fn = compile(equation, Object.keys(params));
    const pv = Object.values(paramValues(params));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const tau = (i / n) * secs;
      const v = fn(tau, tau, f, tau * song.bpm / 60, 0, 0, 0.5, song.bpm, ...pv);
      out[i] = Number.isFinite(v) ? Math.max(-1.2, Math.min(1.2, v)) : 0;
    }
    return out;
  } catch { return null; }
}

const tickLabel = (v) => (v === 0 ? '0' : `${+v.toFixed(v < 0.1 ? 3 : 2)}`);

/**
 * Pre-render a plot: `bg` holds graph paper, axes, ticks, labels and the dim curve;
 * `bright` holds the full-strength curve, revealed up to the playhead each frame.
 */
function renderPlot(canvas, samples, secs, color) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), hgt = Math.max(1, Math.round(canvas.clientHeight * dpr));
  canvas.width = w; canvas.height = hgt;
  const x0 = PLOT_PAD.l * dpr, x1 = w - PLOT_PAD.r * dpr, yT = PLOT_PAD.t * dpr, yB = hgt - PLOT_PAD.b * dpr;
  const ym = (yT + yB) / 2, amp = ((yB - yT) / 2) * 0.86;
  const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = hgt; return c; };
  const bg = mk(), bright = mk();
  const g = bg.getContext('2d');

  // graph paper: minor grid every 8px, major every 5 minor; horizontal lines on y = 0, ±0.5, ±1
  const minor = 8 * dpr;
  g.lineWidth = 1;
  for (let x = x0, k = 0; x <= x1 + 0.5; x += minor, k++) {
    g.strokeStyle = k % 5 ? 'rgba(120,180,255,0.05)' : 'rgba(120,180,255,0.11)';
    g.beginPath(); g.moveTo(Math.round(x) + 0.5, yT); g.lineTo(Math.round(x) + 0.5, yB); g.stroke();
  }
  for (let k = -4; k <= 4; k++) {
    const y = Math.round(ym - (k / 4) * amp) + 0.5;
    g.strokeStyle = k % 2 ? 'rgba(120,180,255,0.05)' : 'rgba(120,180,255,0.11)';
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
  }

  // axes with arrowheads
  const ax = 'rgba(232,232,242,0.7)';
  g.strokeStyle = ax; g.fillStyle = ax; g.lineWidth = Math.max(1, dpr);
  g.beginPath(); g.moveTo(x0, Math.round(ym) + 0.5); g.lineTo(x1 + 6 * dpr, Math.round(ym) + 0.5); g.stroke();
  g.beginPath(); g.moveTo(Math.round(x0) + 0.5, yB + 2 * dpr); g.lineTo(Math.round(x0) + 0.5, yT - 6 * dpr); g.stroke();
  const arrow = (x, y, dx, dy) => {
    g.beginPath(); g.moveTo(x, y);
    g.lineTo(x - dx * 6 * dpr - dy * 3 * dpr, y - dy * 6 * dpr - dx * 3 * dpr);
    g.lineTo(x - dx * 6 * dpr + dy * 3 * dpr, y - dy * 6 * dpr + dx * 3 * dpr);
    g.closePath(); g.fill();
  };
  arrow(x1 + 9 * dpr, Math.round(ym) + 0.5, 1, 0);
  arrow(Math.round(x0) + 0.5, yT - 9 * dpr, 0, -1);

  // ticks and labels
  g.font = `${9.5 * dpr}px "JetBrains Mono", monospace`;
  g.fillStyle = 'rgba(200,200,215,0.75)';
  g.textBaseline = 'middle'; g.textAlign = 'right';
  for (const v of [1, 0, -1]) {
    const y = ym - v * amp;
    g.fillRect(x0 - 3 * dpr, Math.round(y), 3 * dpr, Math.max(1, dpr));
    g.fillText(v < 0 ? '−1' : String(v), x0 - 5 * dpr, y);
  }
  g.textBaseline = 'top'; g.textAlign = 'center';
  const ticks = [0, secs / 2, secs];
  ticks.forEach((v, k) => {
    const x = x0 + (v / secs) * (x1 - x0);
    g.fillRect(Math.round(x), Math.round(ym) - 2 * dpr, Math.max(1, dpr), 4 * dpr);
    g.textAlign = k === 0 ? 'left' : k === ticks.length - 1 ? 'right' : 'center';
    g.fillText(k === ticks.length - 1 ? `${tickLabel(v)} s` : tickLabel(v), x + (k === 0 ? 2 * dpr : 0), yB + 4 * dpr);
  });
  // axis names, set like math
  g.font = `italic ${13 * dpr}px ${MATH_FONT}`;
  g.fillStyle = 'rgba(232,232,242,0.9)';
  g.textAlign = 'right'; g.textBaseline = 'bottom';
  g.fillText('τ', x1 + 8 * dpr, ym - 4 * dpr);
  g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillText('f(τ)', x0 + 6 * dpr, yT - 8 * dpr);

  // the curve: a shaded envelope band plus its upper and lower edges
  const drawCurve = (ctx, alpha, glow) => {
    if (!samples) return;
    const cols = Math.max(1, Math.round(x1 - x0));
    const hi = new Float32Array(cols), lo = new Float32Array(cols);
    for (let c = 0; c < cols; c++) {
      const a = Math.floor((c / cols) * samples.length), b = Math.max(a + 1, Math.floor(((c + 1) / cols) * samples.length));
      let mn = Infinity, mx = -Infinity;
      for (let i = a; i < b; i++) { const v = samples[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      hi[c] = ym - mx * amp; lo[c] = ym - mn * amp;
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, 0, x1 - x0, hgt); ctx.clip();
    ctx.globalAlpha = alpha * 0.22; ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(x0, hi[0]);
    for (let c = 1; c < cols; c++) ctx.lineTo(x0 + c, hi[c]);
    for (let c = cols - 1; c >= 0; c--) ctx.lineTo(x0 + c, lo[c]);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = 1.6 * dpr; ctx.lineJoin = 'round';
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 8 * dpr; }
    for (const edge of [hi, lo]) {
      ctx.beginPath(); ctx.moveTo(x0, edge[0]);
      for (let c = 1; c < cols; c++) ctx.lineTo(x0 + c, edge[c]);
      ctx.stroke();
    }
    ctx.restore();
  };
  drawCurve(g, 0.45, false);
  drawCurve(bright.getContext('2d'), 1, true);
  return { w, hgt, dpr, x0, x1, yT, yB, ym, amp, secs, samples, bg, bright, color };
}

/** Draw a pre-rendered plot, revealing the curve up to time tau (or none if tau is null). */
function drawPlot(canvas, c, tau) {
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, c.w, c.hgt);
  g.drawImage(c.bg, 0, 0);
  if (tau == null || tau > c.secs) return;
  const x = c.x0 + Math.max(0, tau / c.secs) * (c.x1 - c.x0);
  g.drawImage(c.bright, 0, 0, Math.ceil(x), c.hgt, 0, 0, Math.ceil(x), c.hgt);
  g.save();
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = Math.max(1, c.dpr);
  g.setLineDash([3 * c.dpr, 3 * c.dpr]);
  g.beginPath(); g.moveTo(x, c.yT); g.lineTo(x, c.yB); g.stroke();
  g.restore();
  const v = c.samples ? c.samples[Math.min(c.samples.length - 1, Math.floor((tau / c.secs) * c.samples.length))] : 0;
  g.fillStyle = '#fff'; g.shadowColor = c.color; g.shadowBlur = 12 * c.dpr;
  g.beginPath(); g.arc(x, c.ym - v * c.amp, 3.5 * c.dpr, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0;
}

/** Equation as typeset-looking text: 2π for TAU, τ for tau, · for *, superscripts. Text nodes only. */
function prettyEq(equation, params = {}) {
  const frag = document.createDocumentFragment();
  const re = /(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)|([A-Za-z_]\w*)|(\^\s*(\d+(?:\.\d+)?))|(\*)|(\s+)|(.)/gi;
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '.': '·' };
  let m;
  while ((m = re.exec(equation))) {
    let text = m[0], cls = '';
    if (m[1]) cls = 'n';
    else if (m[2]) {
      const id = m[2];
      if (id === 'TAU') { text = '2π'; cls = 'c'; }
      else if (id === 'PI') { text = 'π'; cls = 'c'; }
      else if (id === 'tau') { text = 'τ'; cls = 'v'; }
      else if (Object.hasOwn(FUNCTIONS, id)) cls = 'fn';
      else if (Object.hasOwn(params, id)) cls = 'p';
      else cls = 'v';
    } else if (m[3]) { text = [...m[4]].map((ch) => SUP[ch] ?? ch).join(''); cls = 'sup'; }
    else if (m[5]) text = ' · ';
    else if (m[6]) text = ' ';
    frag.append(cls ? h('span', { class: cls, text }) : text);
  }
  return frag;
}

/** Curve for one sound at one pitch (cached until the equation, params, pitch or size change). */
function curveFor(p, t, f) {
  const key = `${t.equation}|${JSON.stringify(t.params)}|${f}|${p.canvas.clientWidth}x${p.canvas.clientHeight}|${song.bpm}`;
  if (p.cache?.key === key) return p.cache;
  const secs = PLOT_SECONDS[kindOf(t)];
  const samples = sampleCurve(t.equation, t.params, f, secs, Math.max(400, p.canvas.clientWidth * 8));
  const color = getComputedStyle(p.el).getPropertyValue('--c').trim() || '#00e5ff';
  p.cache = { key, ...renderPlot(p.canvas, samples, secs, color) };
  return p.cache;
}

function computeTriggers() {
  const dur = songDuration(song);
  triggerCache = song.tracks.map((t) => {
    if (problem(t)) return [];
    try { return triggers(t, song, dur); } catch { return []; }
  });
}

function updateMonitor(pos) {
  if (!plots.length) return;
  if (pos != null && !triggerCache) computeTriggers();
  plots.forEach((p, i) => {
    const t = song.tracks[i];
    if (!t || p.track !== t) return;
    let hit = null;
    if (pos != null) {
      for (const tr of triggerCache[i] ?? []) {
        if (tr.time > pos) break;
        if (pos < tr.end + 0.004) hit = tr;
      }
    }
    const f = hit ? hit.notes[0] : defaultFreq(t);
    const c = curveFor(p, t, f);
    const tau = hit ? pos - hit.time : null;
    drawPlot(p.canvas, c, tau);
    p.el.classList.toggle('hit', tau != null && tau < 0.09);
    const status = tau != null ? `τ ${tau.toFixed(2)}s${isMelodic(t) ? ` · ${freqName(f)}` : ''}` : `${c.secs}s window`;
    if (p.label.textContent !== status) p.label.textContent = status;
  });
}

// --- Inspector ----------------------------------------------------------------------

function buildInspector() {
  const box = $('#inspector');
  box.textContent = '';
  const t = song.tracks[selected];
  if (!t) {
    box.append(h('div', { class: 'insp-card' }, h('h2', { text: 'No sounds yet' }), h('p', { class: 'small', text: 'Add a sound with the menu under the grid.' })));
    return;
  }
  const kind = kindOf(t);
  box.dataset.kind = kind;
  const refresh = () => { drawWave(wave, t); showSelected(); };

  // 1. Sound
  const nameInput = h('input', { type: 'text', value: t.name, maxlength: 24, 'aria-label': 'Name' });
  nameInput.addEventListener('input', () => {
    t.name = nameInput.value;
    const r = rows[selected];
    if (r) r.el.querySelector('.row-name').firstChild.textContent = t.name;
    const pb = plots[selected]?.el.querySelector('b');
    if (pb) pb.textContent = t.name;
    showSelected(); changed();
  });
  const soundPick = instrumentSelect(t, (id) => {
    const next = makeTrack(id);
    const sameKind = byId[id].kind === kindOf(t);
    Object.assign(next, { gain: t.gain, pan: t.pan, mute: t.mute, solo: t.solo });
    if (sameKind && t.pattern) Object.assign(next, { pattern: t.pattern, rate: t.rate });
    song.tracks[selected] = next;
    picked = null;
    buildGrid(); buildInspector(); showSelected(); changed({ now: true });
  });
  const wave = h('canvas', { class: 'wave', 'aria-hidden': 'true' });
  const knobs = h('div', { class: 'knobs' });
  for (const k of Object.keys(t.params)) {
    const [min, max] = rangeOf(t, k);
    const preset = byId[t.instrument]?.params[k]?.value;
    knobs.append(knob({
      label: k, min, max, value: t.params[k], reset: preset ?? t.params[k],
      scale: min > 0 && max / min >= 20 ? 'log' : 'lin',
      onInput: (v) => { t.params[k] = v; refresh(); changed(); },
    }));
  }
  const soloBtn = h('button', { class: `mini-btn solo${t.solo ? ' on' : ''}`, 'aria-pressed': String(!!t.solo), text: t.solo ? 'Stop solo' : 'Solo: hear only this' });
  soloBtn.addEventListener('click', () => {
    t.solo = !t.solo;
    soloBtn.classList.toggle('on', t.solo);
    soloBtn.setAttribute('aria-pressed', String(t.solo));
    soloBtn.textContent = t.solo ? 'Stop solo' : 'Solo: hear only this';
    paintSilenced();
    changed({ now: true });
  });
  const soundCard = h('section', { class: 'insp-card', 'data-kind': kind },
    h('h2', {}, h('span', { class: 'n', text: '1' }), 'Sound'),
    h('div', { class: 'row2' },
      h('label', { class: 'field' }, h('span', { text: 'Name' }), nameInput),
      h('label', { class: 'field' }, h('span', { text: 'Sound' }), soundPick)),
    wave,
    Object.keys(t.params).length ? h('p', { class: 'small', text: 'Each knob is a number in the equation. Drag up or down, double-click to reset.' }) : null,
    knobs,
    h('div', { class: 'btn-row' },
      h('button', { class: 'mini-btn', text: 'Shuffle knobs', onclick: () => { shuffle(t); buildInspector(); showSelected(); changed({ now: true }); } }),
      soloBtn,
      h('button', { class: 'mini-btn danger', text: 'Remove sound', onclick: () => removeTrack(selected) })));

  // 2. The math
  const eq = h('textarea', { class: 'eq', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', rows: 4, 'aria-label': 'Equation' });
  eq.value = t.equation;
  const err = h('div', { class: 'err', role: 'status' });
  const validate = () => {
    const msg = problem(t);
    eq.classList.toggle('bad', !!msg);
    err.classList.toggle('ok', !msg);
    err.textContent = msg ?? '✓ Valid equation';
    const unknown = msg && /^Unknown name "(\w+)"$/.exec(msg);
    if (unknown && isParamName(unknown[1])) {
      err.append(h('button', { text: `Make "${unknown[1]}" a knob`, onclick: () => {
        t.params[unknown[1]] = 1;
        t.ranges = { ...t.ranges, [unknown[1]]: [0, 10] };
        buildInspector(); changed({ now: true });
      } }));
    }
  };
  eq.addEventListener('input', () => {
    t.equation = eq.value;
    const pe = plots[selected]?.el.querySelector('.plot-eq');
    if (pe) pe.replaceChildren(h('i', { text: 'f(τ)' }), ' = ', prettyEq(t.equation, t.params));
    validate(); refresh(); changed();
  });
  const insert = (text) => {
    const s = eq.selectionStart ?? eq.value.length, e = eq.selectionEnd ?? s;
    eq.setRangeText(text, s, e, 'end');
    eq.focus();
    eq.dispatchEvent(new Event('input'));
  };
  const chips = h('div', { class: 'vars-inline' },
    ...['tau', 'f', 't', 'beat', 'r'].map((v) => h('button', { text: v, title: VARIABLES[v], onclick: () => insert(v) })),
    ...['sin(TAU*f*tau)', 'exp(-tau*8)', 'noise()', 'saw(f*tau)'].map((v) => h('button', { text: v, onclick: () => insert(v) })));
  const mathCard = h('section', { class: 'insp-card', 'data-kind': kind },
    h('h2', {}, h('span', { class: 'n', text: '2' }), 'The math'),
    h('p', { class: 'sub', text: 'This equation is the sound wave. Edit it and hear the change.' }),
    eq, err,
    h('div', { class: 'field' }, h('span', { text: 'Insert' }), chips),
    h('p', { class: 'small', text: 'tau is the time since the note started, f is its pitch. Unknown names can become knobs.' }));
  validate();

  // 3. Rhythm & effects
  const rate = h('select', { 'aria-label': 'Step length' });
  for (const [v, label] of Object.entries(RATES)) rate.add(new Option(label, v));
  rate.value = String(t.rate ?? 4);
  rate.addEventListener('change', () => { t.rate = +rate.value; drawCells(rows[selected]); changed({ now: true }); });

  const patternInput = h('input', { class: 'pattern', spellcheck: 'false', 'aria-label': 'Pattern as text' });
  patternInput.value = t.pattern ?? '';
  patternInput.addEventListener('change', () => {
    t.pattern = patternInput.value.trim();
    let bad = false;
    try { parsePattern(t.pattern); } catch { bad = true; }
    patternInput.classList.toggle('bad', bad);
    picked = null;
    drawCells(rows[selected]); changed({ now: true });
  });

  let noteEditor = null;
  if (isMelodic(t)) {
    const cur = tokensOf(t);
    const tok = picked && picked.track === t ? cur.toks[picked.token] : null;
    if (tok && isHit(tok)) {
      const edit = (fn) => {
        const c = tokensOf(t);
        c.toks[picked.token] = fn(c.toks[picked.token]);
        setTokens(t, false, c.toks);
        drawCells(rows[selected]); buildInspector(); changed({ now: true });
      };
      noteEditor = h('div', { class: 'note-editor' },
        h('div', { class: 'field' }, h('span', { text: `Step ${picked.token + 1} note` }), h('div', { class: 'big', text: tok })),
        h('div', { class: 'btn-row' },
          h('button', { class: 'mini-btn', text: '♭ down', title: 'One semitone lower', onclick: () => edit((x) => transpose(x, -1)) }),
          h('button', { class: 'mini-btn', text: '♯ up', title: 'One semitone higher', onclick: () => edit((x) => transpose(x, 1)) }),
          h('button', { class: 'mini-btn', text: 'Octave −', onclick: () => edit((x) => transpose(x, -12)) }),
          h('button', { class: 'mini-btn', text: 'Octave +', onclick: () => edit((x) => transpose(x, 12)) }),
          h('button', { class: 'mini-btn danger', text: 'Remove', onclick: () => { edit(() => '.'); picked = null; buildInspector(); } })));
    } else {
      noteEditor = h('div', { class: 'note-editor' }, h('p', { class: 'small', text: 'Click a lit step in this row to change its note. Click it again to remove it.' }));
    }
  }

  const fx = h('div', { class: 'knobs' });
  const fxKnob = (label, key, min, max, scale, off, format, title) => fx.append(knob({
    label, min, max, value: t[key] ?? off, reset: byId[t.instrument]?.[key] ?? off, scale, format, title,
    onInput: (v) => { t[key] = v; changed(); },
  }));
  const hz = (v) => (v <= 0 ? 'off' : `${fmt(v)}Hz`);
  fxKnob('low-pass', 'lp', 60, 18000, 'off-log', 0, hz, 'Low-pass filter: darker as you turn it down. Off at zero.');
  fxKnob('high-pass', 'hp', 30, 12000, 'off-log', 0, hz, 'High-pass filter: thinner as you turn it up. Off at zero.');
  fxKnob('echo', 'echo', 0, 0.9, 'lin', 0, (v) => `${Math.round(v * 100)}%`, 'Echo feedback');
  fxKnob('pan', 'pan', -1, 1, 'lin', 0, (v) => (Math.abs(v) < 0.02 ? 'C' : `${v < 0 ? 'L' : 'R'}${Math.round(Math.abs(v) * 100)}`), 'Left / right');

  const rhythmCard = h('section', { class: 'insp-card', 'data-kind': kind },
    h('h2', {}, h('span', { class: 'n', text: '3' }), 'Rhythm & effects'),
    h('label', { class: 'field' }, h('span', { text: 'Each square is a' }), rate),
    noteEditor,
    fx,
    h('details', { class: 'adv' }, h('summary', { text: 'Edit the pattern as text' }), patternInput,
      h('p', { class: 'small', text: isMelodic(t) ? 'Notes like C3, chords like C3+E3+G3, . to wait, - to stop.' : 'x plays, . waits.' })));

  box.append(soundCard, mathCard, rhythmCard);
  requestAnimationFrame(() => drawWave(wave, t));
}

function shuffle(t) {
  for (const k of Object.keys(t.params)) {
    const [min, max] = rangeOf(t, k);
    const r = Math.random();
    t.params[k] = +(min > 0 && max / min >= 20 ? min * (max / min) ** r : min + (max - min) * r).toPrecision(3);
  }
}

/** Big equation on the screen, colored by token type. Built from text nodes only. */
function showSelected() {
  const t = song.tracks[selected];
  const eq = $('#now-eq');
  eq.textContent = '';
  if (!t) { $('#now-name').textContent = 'No sounds'; return; }
  $('#now-name').textContent = `${t.name} · f(t) =`;
  const kindColor = { drums: '--magenta', bass: '--amber', keys: '--cyan', pads: '--violet', fx: '--lime' }[kindOf(t)];
  document.documentElement.style.setProperty('--c', `var(${kindColor})`);
  const re = /(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)|([A-Za-z_]\w*)|(\s+)|(.)/gi;
  let m;
  while ((m = re.exec(t.equation))) {
    const span = h('span', { text: m[0] });
    if (m[1]) span.className = 'num';
    else if (m[2]) {
      if (Object.hasOwn(FUNCTIONS, m[2])) span.className = 'fn';
      else if (Object.hasOwn(VARIABLES, m[2]) || Object.hasOwn(CONSTANTS, m[2])) span.className = 'var';
      else if (Object.hasOwn(t.params, m[2])) span.className = 'par';
    }
    eq.append(span);
  }
}

// --- Screen and playhead ----------------------------------------------------------

const scope = $('#scope');
const timeData = new Float32Array(2048);
const freqData = new Uint8Array(1024);
let lastCol = -1;

function fitCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  scope.width = scope.clientWidth * dpr;
  scope.height = scope.clientHeight * dpr;
}
window.addEventListener('resize', () => { fitCanvas(); const w = $('.wave'); if (w && song.tracks[selected]) drawWave(w, song.tracks[selected]); });

function placePlayhead(frac) {
  const ph = $('#playhead');
  const firstCells = $('#grid .ruler .cells');
  if (!ph || !firstCells) return;
  const grid = $('#grid').getBoundingClientRect();
  const cells = firstCells.getBoundingClientRect();
  ph.style.left = `${cells.left - grid.left + frac * cells.width}px`;
}

// On phones one bar fills the grid; turn the page as the playhead moves on, unless the
// listener has just swiped to look at another bar.
const phone = matchMedia('(max-width: 700px)');
const seqPanel = $('.seq-panel');
let swipedAt = 0;
for (const ev of ['touchstart', 'pointerdown', 'wheel']) seqPanel.addEventListener(ev, () => { swipedAt = performance.now(); }, { passive: true });
function followBar(col) {
  if (!phone.matches || performance.now() - swipedAt < 4000) return;
  const cells = $('#grid .ruler .cells');
  if (!cells) return;
  const left = Math.floor(col / 16) * cells.getBoundingClientRect().width * 16 / totalCols();
  if (Math.abs(seqPanel.scrollLeft - left) > 2) seqPanel.scrollTo({ left, behavior: 'smooth' });
}

function frame() {
  requestAnimationFrame(frame);
  drawLab();
  const g = scope.getContext('2d');
  const { width: w, height: hgt } = scope;
  g.clearRect(0, 0, w, hgt);
  const color = getComputedStyle(document.documentElement).getPropertyValue('--c').trim() || '#00e5ff';
  g.strokeStyle = 'rgba(255,255,255,0.04)';
  g.lineWidth = 1;
  for (let x = 0; x < w; x += w / 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, hgt); g.stroke(); }

  if (player.playing && player.analyser) {
    player.analyser.getByteFrequencyData(freqData);
    const bars = 96;
    for (let b = 0; b < bars; b++) {
      const lo = Math.floor(2 ** (b / bars * 9.5)), hi = Math.max(lo + 1, Math.floor(2 ** ((b + 1) / bars * 9.5)));
      let v = 0;
      for (let k = lo; k < hi && k < freqData.length; k++) v = Math.max(v, freqData[k]);
      const bh = (v / 255) * hgt * 0.6;
      g.fillStyle = `hsla(${190 + b * 1.4}, 100%, 60%, 0.22)`;
      g.fillRect(b * (w / bars) + 1, hgt - bh, w / bars - 2, bh);
    }
    player.analyser.getFloatTimeDomainData(timeData);
    let start = 0;
    for (let k = 1; k < 1024; k++) if (timeData[k - 1] < 0 && timeData[k] >= 0) { start = k; break; }
    g.strokeStyle = color; g.shadowColor = color; g.shadowBlur = 14;
    g.lineWidth = 2.5 * (w / scope.clientWidth);
    g.beginPath();
    for (let k = 0; k < 1024; k++) {
      const x = (k / 1023) * w, y = hgt * 0.62 - timeData[start + k] * hgt * 0.34;
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke(); g.shadowBlur = 0;

    const pos = player.position;
    const spb = 60 / song.bpm;
    const loop = song.bars * 4 * spb;
    placePlayhead((pos % loop) / loop);
    $('#clock').value = `${Math.floor(pos / 60)}:${(pos % 60).toFixed(1).padStart(4, '0')}`;
    const col = Math.floor(pos / (spb / 4)) % totalCols();
    if (col !== lastCol) {
      lastCol = col;
      followBar(col);
      for (const r of rows) {
        r.nowCell?.classList.remove('now');
        const c = r.cellEls?.[Math.floor(col / r.span)];
        if (c?.classList.contains('on')) { c.classList.add('now'); r.nowCell = c; } else r.nowCell = null;
      }
    }
    updateMonitor(pos % loop);
    rows.forEach((r, i) => {
      const stem = player.stems?.[stemIndex[i]];
      let rms = 0;
      if (stem) {
        const c = Math.floor(pos * player.ctx.sampleRate);
        for (let j = Math.max(0, c - 1024); j < Math.min(stem.length, c + 1024); j += 4) rms += stem[j] * stem[j];
        rms = Math.sqrt(rms / 512);
      }
      r.vu.style.width = `${Math.min(100, rms * 260)}%`;
    });
  } else {
    updateMonitor(null);
    const t = song.tracks[selected];
    if (t && !problem(t)) {
      const s = voiceSamples(t, 600, { drums: 0.4, fx: 0.4, bass: 0.05, keys: 0.03, pads: 0.03 }[kindOf(t)]);
      const breathe = 0.85 + 0.15 * Math.sin(performance.now() / 600);
      g.strokeStyle = color; g.globalAlpha = 0.5; g.shadowColor = color; g.shadowBlur = 12;
      g.lineWidth = 2 * (w / scope.clientWidth);
      g.beginPath();
      for (let k = 0; k < s.length; k++) {
        const x = (k / (s.length - 1)) * w, y = hgt * 0.65 - s[k] * hgt * 0.28 * breathe;
        k ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke(); g.globalAlpha = 1; g.shadowBlur = 0;
    }
  }
}

// --- Equation lab: paste an equation, hear it, plot it, add it -----------------------

const LAB_EXAMPLES = [
  ['Plucked sine', 'sin(TAU*f*tau) * exp(-tau*4)'],
  ['Kick drop', 'sin(TAU*(50*tau + 4*(1 - exp(-30*tau)))) * exp(-6*tau)'],
  ['FM bell', 'sin(TAU*f*tau + 3*exp(-2*tau)*sin(TAU*3.5*f*tau)) * exp(-3*tau)'],
  ['Major chord', '(sin(TAU*f*tau) + sin(TAU*1.26*f*tau) + sin(TAU*1.5*f*tau)) / 3 * exp(-tau*1.5)'],
  ['Wobble bass', 'saw(f*tau) * (0.5 + 0.5*sin(TAU*4*tau))'],
  ['Siren', 'sin(TAU*f*tau + 150*sin(TAU*1.5*tau))'],
  ['Laser', 'sqr(1800*tau - 5000*tau^2) * exp(-tau*6)'],
  ['Noise hat', 'noise() * exp(-tau*40)'],
];
const lab = { eq: $('#lab-eq'), note: $('#lab-note'), len: $('#lab-len'), status: $('#lab-status'), canvas: $('#lab-plot'), cache: null, play: null, ctx: null, src: null };

/** Compile the lab equation; unknown names become parameters set to 1. */
function labParse() {
  const equation = lab.eq.value.trim();
  const params = {};
  for (let k = 0; k < 8; k++) {
    try {
      compile(equation, Object.keys(params));
      return { equation, params, error: null };
    } catch (e) {
      if (!(e instanceof EquationError)) throw e;
      const m = /^Unknown name "(\w+)"$/.exec(e.message);
      if (m && isParamName(m[1])) { params[m[1]] = 1; continue; }
      return { equation, params, error: e.message };
    }
  }
  return { equation, params, error: 'Too many unknown names' };
}

function labUpdate() {
  const { params, error } = labParse();
  const f = noteToFreq(lab.note.value);
  lab.status.classList.toggle('bad', !!error);
  const extra = Object.keys(params).length ? ` · ${Object.keys(params).join(', ')} = 1 (add it to the beat to get a knob)` : '';
  lab.status.textContent = error ?? `✓ Plotted over ${lab.len.value} s at ${lab.note.value} (${Math.round(f)} Hz)${extra}`;
  $('#lab-play').disabled = !!error;
  $('#lab-add').disabled = !!error;
  lab.cache = null;
}

function drawLab() {
  const { equation, params, error } = labParse();
  const secs = +lab.len.value;
  const key = `${equation}|${lab.note.value}|${secs}|${lab.canvas.clientWidth}x${lab.canvas.clientHeight}|${song.bpm}`;
  if (lab.cache?.key !== key) {
    const samples = error ? null : sampleCurve(equation, params, noteToFreq(lab.note.value), secs, Math.max(800, lab.canvas.clientWidth * 8));
    lab.cache = { key, ...renderPlot(lab.canvas, samples, secs, '#00e5ff') };
  }
  let tau = null;
  if (lab.play) {
    tau = lab.play.ctx.currentTime - lab.play.start;
    if (tau > secs) { lab.play = null; tau = null; }
  }
  drawPlot(lab.canvas, lab.cache, tau);
}

$('#lab-play').addEventListener('click', async () => {
  const { equation, params, error } = labParse();
  if (error) return;
  unlockAudio();
  const ctx = player.ctx ?? (lab.ctx ??= new AudioContext());
  await ctx.resume();
  const len = +lab.len.value;
  const { left, right } = renderSong({
    bpm: song.bpm, duration: len, fadeOut: 0.02,
    tracks: [{ name: 'Lab', equation, params, at: [0], note: lab.note.value, len, gain: 0.9 }],
  }, { sampleRate: ctx.sampleRate });
  const buffer = ctx.createBuffer(2, left.length, ctx.sampleRate);
  buffer.copyToChannel(left, 0);
  buffer.copyToChannel(right, 1);
  try { lab.src?.stop(); } catch {}
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const g = ctx.createGain();
  g.gain.value = +$('#volume').value;
  src.connect(g).connect(ctx.destination);
  src.start();
  lab.src = src;
  lab.play = { ctx, start: ctx.currentTime };
});

$('#lab-add').addEventListener('click', () => {
  const { equation, params, error } = labParse();
  if (error || song.tracks.length >= 16) return;
  const note = lab.note.value;
  const usesPitch = /\bf\b/.test(equation);
  song.tracks.push({
    name: 'Lab sound', equation, params,
    ranges: Object.fromEntries(Object.keys(params).map((k) => [k, [0, 10]])),
    pattern: usesPitch ? `${note} . . . . . . . ${note} . . . . . . .` : 'x.......x.......',
    rate: 4, note, gain: 0.7, pan: 0,
  });
  selected = song.tracks.length - 1;
  picked = null;
  buildGrid(); buildInspector(); showSelected(); changed({ now: true });
  $('.seq-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast('Added "Lab sound" to the beat: click its squares to change the rhythm');
});

for (const el of [lab.eq, lab.note, lab.len]) el.addEventListener('input', labUpdate);
lab.eq.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#lab-play').click(); });
for (const [label, eq] of LAB_EXAMPLES) {
  $('#lab-examples').append(h('button', { text: label, title: eq, onclick: () => { lab.eq.value = eq; labUpdate(); $('#lab-play').click(); } }));
}
labUpdate();

// --- Transport and actions ---------------------------------------------------------

function toast(text, action) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, text);
  if (action) el.append(h('button', { text: action.label, onclick: () => { el.remove(); action.run(); } }));
  document.body.append(el);
  setTimeout(() => el.remove(), action ? 6000 : 2200);
}

/** Remove a sound, with an Undo in the toast. */
function removeTrack(i) {
  const [gone] = song.tracks.splice(i, 1);
  if (!gone) return;
  selected = Math.max(0, Math.min(selected > i ? selected - 1 : selected, song.tracks.length - 1));
  picked = null;
  buildGrid(); buildInspector(); showSelected(); changed({ now: true });
  toast(`Removed ${gone.name}`, { label: 'Undo', run: () => {
    song.tracks.splice(Math.min(i, song.tracks.length), 0, gone);
    selected = i;
    buildGrid(); buildInspector(); showSelected(); changed({ now: true });
  } });
}

// iPhones play Web Audio on the ringer channel, so the silent switch mutes it. Ask for media
// playback instead (Safari 17+); older iOS needs a silent <audio> loop started from a tap.
try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
let silentLoop = null;
function unlockAudio() {
  if (navigator.audioSession || silentLoop) return;
  const quiet = new Float32Array(4410);
  silentLoop = new Audio(URL.createObjectURL(new Blob([toWav(quiet, quiet, 44100)], { type: 'audio/wav' })));
  silentLoop.loop = true;
  silentLoop.setAttribute('playsinline', '');
  silentLoop.play().catch(() => { silentLoop = null; });
}

async function play() {
  unlockAudio();
  await player.play(playable());
  player.volume = +$('#volume').value;
  $('#play').classList.add('on');
  $('#play-label').textContent = 'Stop';
  $('#play').setAttribute('aria-label', 'Stop');
  $('#playhead')?.classList.add('on');
}
function stop() {
  player.stop();
  $('#play').classList.remove('on');
  $('#play-label').textContent = 'Play';
  $('#play').setAttribute('aria-label', 'Play');
  $('#playhead')?.classList.remove('on');
  for (const r of rows) { r.nowCell?.classList.remove('now'); r.vu.style.width = '0'; }
  lastCol = -1;
}

$('#play').addEventListener('click', () => (player.playing ? stop() : play()));
$('#volume').addEventListener('input', (e) => { player.volume = +e.target.value; });
$('#bpm').addEventListener('change', (e) => { song.bpm = num(e.target.value, 40, 220, 120); e.target.value = song.bpm; changed({ now: true }); });
$('#bars').addEventListener('change', (e) => { song.bars = +e.target.value; buildGrid(); changed({ now: true }); });
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.target.closest('input, textarea, select, button, [role=slider]')) return;
  e.preventDefault();
  player.playing ? stop() : play();
});

const songPick = $('#song');
for (const [id, s] of Object.entries(SONGS)) songPick.add(new Option(s.title, id));
songPick.add(new Option('Blank (one kick)', 'blank'));
songPick.addEventListener('change', () => {
  if (songPick.value === 'shared') return;
  load(songPick.value === 'blank' ? { title: 'Blank', bpm: 120, bars: 4, tracks: [makeTrack('kick')] } : structuredClone(SONGS[songPick.value]));
  changed({ now: true });
});

$('#random').addEventListener('click', () => { song.tracks.forEach(shuffle); buildInspector(); showSelected(); changed({ now: true }); toast('Every knob shuffled'); });

$('#export').addEventListener('click', () => {
  const { left, right, sampleRate } = renderSong(playable(), { sampleRate: 44100 });
  const url = URL.createObjectURL(new Blob([toWav(left, right, sampleRate)], { type: 'audio/wav' }));
  const a = h('a', { href: url, download: `equalizer-${(song.title || 'beat').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.wav` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('WAV exported');
});

const b64 = {
  encode: (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))),
};
// Share links: the song as JSON, minus anything that matches the defaults (a built-in sound's
// equation, zero effects), deflated and base64url-encoded into the hash (#z=). Old #s= links
// (plain base64 JSON) still open.
const TRACK_DEFAULTS = { rate: 4, pan: 0, lp: 0, hp: 0, echo: 0, echoTime: 0.75, mute: false, solo: false };
function slim(s) {
  return { ...s, tracks: s.tracks.map((t) => {
    const out = {};
    for (const [k, v] of Object.entries(t)) {
      if (v === undefined || TRACK_DEFAULTS[k] === v) continue;
      if (k === 'equation' && v === byId[t.instrument]?.equation) continue;
      if (k === 'ranges' && !Object.keys(v).length) continue;
      out[k] = v;
    }
    return out;
  }) };
}
function unslim(s) {
  for (const t of Array.isArray(s?.tracks) ? s.tracks : []) {
    if (t && t.equation == null && Object.hasOwn(byId, t.instrument)) t.equation = byId[t.instrument].equation;
  }
  return s;
}
const pipeBytes = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
const toB64url = (bytes) => { let bin = ''; for (const x of bytes) bin += String.fromCharCode(x); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromB64url = (str) => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function shareHash(s) {
  const json = JSON.stringify(slim(s));
  if (typeof CompressionStream === 'undefined') return `#s=${b64.encode(json)}`;
  return `#z=${toB64url(await pipeBytes(new TextEncoder().encode(json), new CompressionStream('deflate-raw')))}`;
}
async function songFromHash(hash) {
  if (hash.startsWith('#s=')) return unslim(JSON.parse(b64.decode(hash.slice(3))));
  if (hash.startsWith('#z=')) return unslim(JSON.parse(new TextDecoder().decode(await pipeBytes(fromB64url(hash.slice(3)), new DecompressionStream('deflate-raw')))));
  return null;
}

$('#share').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}${await shareHash(song)}`;
  history.replaceState(null, '', url);
  // Phones get the native share sheet (Messages, WhatsApp, ...); everyone else gets the clipboard.
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: `${song.title} · equalizer`, text: 'A beat made from math equations', url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied: anyone can open your beat'); }
  catch { window.prompt('Copy this link to share your beat:', url); }
});

// tips
const tips = $('#tips');
try { if (localStorage.getItem('eq-tips') === 'hidden') tips.hidden = true; } catch {}
$('#tips-close').addEventListener('click', () => { tips.hidden = true; try { localStorage.setItem('eq-tips', 'hidden'); } catch {} });
$('#help-btn').addEventListener('click', () => {
  tips.hidden = !tips.hidden;
  if (!tips.hidden) tips.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  $('#cheats details').open = true;
});

function load(s) {
  song = sanitize(s);
  selected = 0;
  picked = null;
  $('#bpm').value = String(song.bpm);
  $('#bars').value = String(song.bars);
  buildGrid();
  $('#inspector').textContent = '';
  buildInspector();
  showSelected();
}

// cheat sheet
const vars = $('#vars');
for (const [k, v] of Object.entries(VARIABLES)) vars.append(h('dt', { text: k }), h('dd', { text: v }));
$('#fns').textContent = [...Object.keys(FUNCTIONS), ...Object.keys(CONSTANTS)].join(' ');

// --- Start ---------------------------------------------------------------------------

function showShared() {
  if (![...songPick.options].some((o) => o.value === 'shared')) songPick.add(new Option('Shared beat', 'shared'));
  songPick.value = 'shared';
}
let initial = null;
try { initial = await songFromHash(location.hash); if (initial) showShared(); }
catch { toast("That share link couldn't be read"); }
// Pasting a share link into a tab that already has the studio open only changes the hash.
window.addEventListener('hashchange', async () => {
  try {
    const shared = await songFromHash(location.hash);
    if (!shared) return;
    load(shared);
    showShared();
    changed({ now: true });
  } catch { toast("That share link couldn't be read"); }
});
if (!initial) { try { initial = JSON.parse(localStorage.getItem('eq-song-v2')); } catch {} }
load(initial ?? structuredClone(SONGS.trap));
if (!initial) songPick.value = 'trap';
fitCanvas();
requestAnimationFrame(frame);

// --- Sound on by default ---------------------------------------------------------------
// Browsers only allow audio after the visitor interacts with the page, so: start right away
// if autoplay is allowed, otherwise show a splash whose first tap (or key) drops the beat.
const APP_NAME = 'equalizer';
const KIND_COLORS = { drums: '#ff3cac', bass: '#ffb020', keys: '#00e5ff', pads: '#9d7bff', fx: '#b6ff3c' };

(function autoStart() {
  try {
    const probe = new AudioContext();
    const allowed = probe.state === 'running';
    probe.close();
    if (allowed) { play(); return; }
  } catch {}

  const lead = song.tracks.find((t) => !problem(t) && kindOf(t) !== 'fx') ?? song.tracks[0];
  const canvas = h('canvas', { class: 'splash__waves', 'aria-hidden': 'true' });
  const go = h('button', { class: 'splash__go', type: 'button' });
  go.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>Tap to drop the beat';
  const splash = h('div', { class: 'splash', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Start ${song.title}` },
    canvas,
    h('div', { class: 'splash__card' },
      h('div', { class: 'splash__brand', text: APP_NAME }),
      h('div', { class: 'splash__song', text: song.title }),
      lead ? h('div', { class: 'splash__eq' }, h('i', { text: 'f(τ)' }), ' = ', prettyEq(lead.equation, lead.params)) : null,
      go,
      h('p', { class: 'splash__note', text: 'Every sound is a math equation. No samples.' })));
  document.body.append(splash);
  document.documentElement.classList.add('splash-open');

  // The waves are this song's own equations, drawn and slowly scrolling.
  const waves = song.tracks.filter((t) => !problem(t)).slice(0, 6).map((t) => {
    const kind = kindOf(t);
    try { return { color: KIND_COLORS[kind], s: voiceSamples(t, 480, { drums: 0.35, fx: 0.4, bass: 0.06, keys: 0.03, pads: 0.03 }[kind]) }; }
    catch { return null; }
  }).filter(Boolean);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0;
  const draw = (now) => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = canvas.width = canvas.clientWidth * dpr, hgt = canvas.height = canvas.clientHeight * dpr;
    const g = canvas.getContext('2d');
    g.lineWidth = 2.2 * dpr;
    g.globalCompositeOperation = 'lighter';
    waves.forEach(({ color, s }, i) => {
      const y0 = hgt * (0.18 + 0.64 * (i + 0.5) / waves.length), amp = hgt / (waves.length + 1) * 0.55;
      const shift = still ? 0 : (now / 1000) * (40 + i * 13);
      g.strokeStyle = color; g.shadowColor = color; g.shadowBlur = 14 * dpr; g.globalAlpha = 0.55;
      g.beginPath();
      for (let x = 0; x <= w; x += 2 * dpr) {
        const k = Math.floor((x / dpr + shift) % s.length);
        const y = y0 - s[k] * amp * (0.85 + 0.15 * Math.sin(now / 700 + i));
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    });
    if (!still) raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  // iOS only lets audio start from a real tap (click/touchend) or a key press.
  let started = false;
  const start = (e) => {
    if (started) return;
    started = true;
    e?.preventDefault();
    unlockAudio();
    play();
    splash.classList.add('splash--out');
    document.documentElement.classList.remove('splash-open');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => { cancelAnimationFrame(raf); splash.remove(); }, 450);
  };
  const onKey = (e) => { if (!e.metaKey && !e.ctrlKey && !e.altKey) start(e); };
  splash.addEventListener('click', start);
  document.addEventListener('keydown', onKey, true);
})();
