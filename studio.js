import {
  compile, EquationError, isParamName, noteToFreq, parsePattern, paramValues, renderSong, toWav, Player, VARIABLES, FUNCTIONS, CONSTANTS,
} from './src/equalizer.js';
import { INSTRUMENTS, SONGS, byId, track as makeTrack } from './src/presets.js';

const $ = (sel, el = document) => el.querySelector(sel);
const player = new Player();
const KINDS = { drums: 'Drums', bass: 'Bass', keys: 'Keys & leads', pads: 'Pads', fx: 'FX' };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
let song;
let selected = 0;
let strips = [];          // { el, track, pads, vu, mode }
let stemIndex = [];       // song track index -> index in the rendered stems

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
      name: str(t?.name, 24, 'Channel'),
      instrument: Object.hasOwn(byId, t?.instrument) ? t.instrument : undefined,
      equation: str(t?.equation, 2000, '0'),
      params, ranges,
      pattern: str(t?.pattern, 800),
      rate: [4, 2, 1, 0.25].includes(+t?.rate) ? +t.rate : 4,
      note: noteToFreq(str(t?.note, 4)) ? t.note : undefined,
      gain: num(t?.gain, 0, 1.5, 0.7), pan: num(t?.pan, -1, 1, 0),
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

/** The song minus channels whose equations don't compile, so a typo never stops the music. */
function playable() {
  stemIndex = [];
  const tracks = [];
  song.tracks.forEach((t, i) => { if (!problem(t)) { stemIndex[i] = tracks.length; tracks.push(t); } });
  return { ...song, tracks };
}

let renderTimer;
function changed({ now = false } = {}) {
  clearTimeout(renderTimer);
  const go = () => {
    try { localStorage.setItem('eq-song', JSON.stringify(song)); } catch {}
    if (player.playing) player.update(playable());
  };
  if (now) go(); else renderTimer = setTimeout(go, 140);
}

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
function knob({ label, min, max, value, scale = 'lin', reset = value, format = fmt, onInput }) {
  const wrap = document.createElement('div');
  wrap.className = 'knob-wrap';
  const el = document.createElement('div');
  el.className = 'knob';
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', label);
  const val = document.createElement('div');
  val.className = 'knob-value';
  const lab = document.createElement('div');
  lab.className = 'knob-label';
  lab.textContent = label;
  wrap.append(el, val, lab);

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
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    startY = e.clientY; startN = n;
    el.focus();
  });
  el.addEventListener('pointermove', (e) => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    set(startN + (startY - e.clientY) / (e.shiftKey ? 600 : 150));
  });
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

// --- Patterns -----------------------------------------------------------------------

const isCompact = (p) => !/\s/.test(p.trim());
function tokensOf(t) {
  const p = (t.pattern ?? '').trim();
  if (!p) return { compact: true, toks: Array(16).fill('.') };
  return isCompact(p) ? { compact: true, toks: [...p.replace(/\|/g, '')] } : { compact: false, toks: p.split(/\s+/) };
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
const isNote = (tok) => tok !== '.' && tok !== '_' && tok !== '-' && tok.toLowerCase() !== 'x';

// --- Mini waveform ------------------------------------------------------------------

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
  const g = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  g.clearRect(0, 0, w, h);
  const color = getComputedStyle(canvas).getPropertyValue('--c').trim() || '#00e5ff';
  g.strokeStyle = '#1d1d28';
  g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  if (problem(t)) return;
  const secs = { drums: 0.5, fx: 0.5, bass: 0.8, keys: 1, pads: 1.5 }[kindOf(t)];
  const per = 8;
  const s = voiceSamples(t, w * per, secs);
  g.fillStyle = color;
  g.shadowColor = color;
  g.shadowBlur = 6;
  for (let x = 0; x < w; x++) {
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < per; k++) { const v = s[x * per + k]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const y1 = h / 2 - hi * h * 0.42, y2 = h / 2 - lo * h * 0.42;
    g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
}

// --- Strips -------------------------------------------------------------------------

function instrumentOptions(select, t) {
  select.textContent = '';
  if (!t.instrument) {
    const o = new Option('Custom equation', '');
    select.add(o);
  }
  for (const [kind, label] of Object.entries(KINDS)) {
    const group = document.createElement('optgroup');
    group.label = label;
    for (const inst of INSTRUMENTS.filter((i) => i.kind === kind)) group.append(new Option(inst.name, inst.id));
    select.append(group);
  }
  select.value = t.instrument ?? '';
}

function buildStrip(t, i) {
  const el = $('#strip-tpl').content.firstElementChild.cloneNode(true);
  const s = { el, track: t };
  el.dataset.kind = kindOf(t);
  el.classList.toggle('muted', !!t.mute);

  const name = $('.name', el);
  name.value = t.name;
  name.addEventListener('input', () => { t.name = name.value; if (i === selected) showSelected(); changed(); });

  const mute = $('.mute', el), solo = $('.solo', el);
  mute.classList.toggle('on', !!t.mute);
  solo.classList.toggle('on', !!t.solo);
  mute.setAttribute('aria-pressed', String(!!t.mute));
  solo.setAttribute('aria-pressed', String(!!t.solo));
  mute.addEventListener('click', () => { t.mute = !t.mute; mute.classList.toggle('on', t.mute); mute.setAttribute('aria-pressed', String(t.mute)); el.classList.toggle('muted', t.mute); changed({ now: true }); });
  solo.addEventListener('click', () => { t.solo = !t.solo; solo.classList.toggle('on', t.solo); solo.setAttribute('aria-pressed', String(t.solo)); changed({ now: true }); });
  $('.dice', el).addEventListener('click', () => { shuffle(t); rebuild(); changed({ now: true }); });
  $('.remove', el).addEventListener('click', () => {
    song.tracks.splice(i, 1);
    selected = Math.min(selected, song.tracks.length - 1);
    rebuild(); changed({ now: true });
  });

  const inst = $('.inst', el);
  instrumentOptions(inst, t);
  inst.addEventListener('change', () => {
    const next = makeTrack(inst.value);
    const sameKind = byId[inst.value].kind === kindOf(t);
    Object.assign(next, { gain: t.gain, pan: t.pan, mute: t.mute, solo: t.solo });
    if (sameKind && t.pattern) Object.assign(next, { pattern: t.pattern, rate: t.rate });
    song.tracks[i] = next;
    rebuild(); changed({ now: true });
  });

  const eq = $('.eq', el), err = $('.err', el);
  eq.value = t.equation;
  const validate = () => {
    const msg = problem(t);
    eq.classList.toggle('bad', !!msg);
    err.textContent = msg ?? '';
    const unknown = msg && /^Unknown name "(\w+)"$/.exec(msg);
    if (unknown && isParamName(unknown[1])) {
      const b = document.createElement('button');
      b.textContent = `Add "${unknown[1]}" as a knob`;
      b.addEventListener('click', () => {
        t.params[unknown[1]] = 1;
        t.ranges = { ...t.ranges, [unknown[1]]: [0, 10] };
        rebuild(); changed({ now: true });
      });
      err.append(b);
    }
    drawWave($('.wave', el), t);
    if (i === selected) showSelected();
  };
  eq.addEventListener('input', () => { t.equation = eq.value; validate(); changed(); });

  const params = $('.params', el);
  for (const k of Object.keys(t.params)) {
    const [min, max] = rangeOf(t, k);
    const preset = byId[t.instrument]?.params[k]?.value;
    params.append(knob({
      label: k, min, max, value: t.params[k], reset: preset ?? t.params[k],
      scale: min > 0 && max / min >= 20 ? 'log' : 'lin',
      onInput: (v) => { t.params[k] = v; drawWave($('.wave', el), t); if (i === selected) showSelected(); changed(); },
    }));
  }

  const rate = $('.rate', el);
  rate.value = String(t.rate ?? 4);
  rate.addEventListener('change', () => { t.rate = +rate.value; changed({ now: true }); });

  const patternInput = $('.pattern', el);
  patternInput.value = t.pattern ?? '';
  patternInput.addEventListener('change', () => {
    t.pattern = patternInput.value.trim();
    drawPads(s); validate(); changed({ now: true });
  });
  s.patternInput = patternInput;
  drawPads(s);

  const fx = $('.fx', el);
  const fxKnob = (label, key, min, max, scale, off = 0, format) => fx.append(knob({
    label, min, max, value: t[key] ?? off, reset: byId[t.instrument]?.[key] ?? off, scale, format,
    onInput: (v) => { t[key] = v; changed(); },
  }));
  const hz = (v) => (v <= 0 ? 'off' : `${fmt(v)}Hz`);
  fxKnob('low-pass', 'lp', 60, 18000, 'off-log', 0, hz);
  fxKnob('high-pass', 'hp', 30, 12000, 'off-log', 0, hz);
  fxKnob('echo', 'echo', 0, 0.9, 'lin', 0, (v) => `${Math.round(v * 100)}%`);
  fxKnob('pan', 'pan', -1, 1, 'lin', 0, (v) => (Math.abs(v) < 0.02 ? 'C' : `${v < 0 ? 'L' : 'R'}${Math.round(Math.abs(v) * 100)}`));

  const gain = $('.gain', el);
  gain.value = String(t.gain ?? 0.8);
  gain.addEventListener('input', () => { t.gain = +gain.value; changed(); });
  s.vu = $('.vu i', el);

  el.addEventListener('pointerdown', () => { if (selected !== i) { selected = i; markSelected(); showSelected(); } });
  validate();
  return s;
}

function drawPads(s) {
  const t = s.track;
  const seq = $('.seq', s.el);
  seq.textContent = '';
  const { compact, toks } = tokensOf(t);
  s.mode = compact;
  s.length = toks.length;
  seq.classList.toggle('wide', toks.length > 16);
  s.pads = toks.slice(0, 64).map((tok, k) => {
    const b = document.createElement('button');
    b.className = 'pad';
    const on = compact ? tok.toLowerCase() === 'x' : isNote(tok) || tok.toLowerCase() === 'x';
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', `Step ${k + 1}${on && !compact ? `, ${tok}` : ''}`);
    if (!compact && isNote(tok)) { b.textContent = tok.split('+')[0] + (tok.includes('+') ? '+' : ''); b.title = tok; }
    b.addEventListener('click', () => {
      const cur = tokensOf(t);
      if (cur.compact) cur.toks[k] = cur.toks[k].toLowerCase() === 'x' ? '.' : 'x';
      else if (isNote(cur.toks[k]) || cur.toks[k].toLowerCase() === 'x') cur.toks[k] = '.';
      else cur.toks[k] = [...cur.toks.slice(0, k)].reverse().find(isNote) ?? cur.toks.find(isNote) ?? 'C4';
      t.pattern = cur.toks.join(cur.compact ? '' : ' ');
      s.patternInput.value = t.pattern;
      drawPads(s); changed({ now: true });
    });
    if (!compact) {
      b.addEventListener('wheel', (e) => {
        const cur = tokensOf(t);
        if (!isNote(cur.toks[k])) return;
        e.preventDefault();
        cur.toks[k] = transpose(cur.toks[k], (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 12 : 1));
        t.pattern = cur.toks.join(' ');
        s.patternInput.value = t.pattern;
        drawPads(s); changed();
      }, { passive: false });
    }
    seq.append(b);
    return b;
  });
}

function shuffle(t) {
  for (const k of Object.keys(t.params)) {
    const [min, max] = rangeOf(t, k);
    const r = Math.random();
    t.params[k] = +(min > 0 && max / min >= 20 ? min * (max / min) ** r : min + (max - min) * r).toPrecision(3);
  }
}

function rebuild() {
  const mixer = $('#mixer');
  mixer.textContent = '';
  strips = song.tracks.map((t, i) => buildStrip(t, i));
  for (const s of strips) mixer.append(s.el);

  const add = document.createElement('div');
  add.className = 'add-strip';
  const label = document.createElement('div');
  label.textContent = '+ Add a channel';
  const pick = document.createElement('select');
  pick.setAttribute('aria-label', 'Add a channel');
  pick.append(new Option('Pick an equation…', ''));
  for (const [kind, name] of Object.entries(KINDS)) {
    const group = document.createElement('optgroup');
    group.label = name;
    for (const inst of INSTRUMENTS.filter((x) => x.kind === kind)) group.append(new Option(inst.name, inst.id));
    pick.append(group);
  }
  pick.addEventListener('change', () => {
    if (!pick.value) return;
    const t = makeTrack(pick.value);
    if (!t.pattern) t.pattern = 'x...............';
    song.tracks.push(t);
    selected = song.tracks.length - 1;
    rebuild(); changed({ now: true });
    $('#mixer').scrollTo({ left: $('#mixer').scrollWidth, behavior: 'smooth' });
  });
  add.append(label, pick);
  if (song.tracks.length < 16) mixer.append(add);

  $('#bpm').value = String(song.bpm);
  $('#bars').value = String(song.bars);
  markSelected();
  showSelected();
}

function markSelected() {
  strips.forEach((s, i) => s.el.classList.toggle('selected', i === selected));
}

/** Big equation on the screen, colored by token type. Built from text nodes only. */
function showSelected() {
  const t = song.tracks[selected];
  const eq = $('#now-eq');
  eq.textContent = '';
  if (!t) { $('#now-name').textContent = 'No channels'; return; }
  $('#now-name').textContent = `${t.name} · f(t) =`;
  document.documentElement.style.setProperty('--c', getComputedStyle(strips[selected]?.el ?? document.body).getPropertyValue('--c'));
  const re = /(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)|([A-Za-z_]\w*)|(\s+)|(.)/gi;
  let m;
  while ((m = re.exec(t.equation))) {
    const span = document.createElement('span');
    span.textContent = m[0];
    if (m[1]) span.className = 'num';
    else if (m[2]) {
      if (Object.hasOwn(FUNCTIONS, m[2])) span.className = 'fn';
      else if (Object.hasOwn(VARIABLES, m[2]) || Object.hasOwn(CONSTANTS, m[2])) span.className = 'var';
      else if (Object.hasOwn(t.params, m[2])) span.className = 'par';
    }
    eq.append(span);
  }
}

// --- Screen -------------------------------------------------------------------------

const scope = $('#scope');
const leds = $('#leds');
for (let k = 0; k < 16; k++) leds.append(document.createElement('i'));
const timeData = new Float32Array(2048);
const freqData = new Uint8Array(1024);
let lastLed = -1;

function fitCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  scope.width = scope.clientWidth * dpr;
  scope.height = scope.clientHeight * dpr;
}
window.addEventListener('resize', fitCanvas);

function frame() {
  requestAnimationFrame(frame);
  const g = scope.getContext('2d');
  const { width: w, height: h } = scope;
  g.clearRect(0, 0, w, h);
  const color = getComputedStyle(document.documentElement).getPropertyValue('--c').trim() || '#00e5ff';

  // grid
  g.strokeStyle = 'rgba(255,255,255,0.04)';
  g.lineWidth = 1;
  for (let x = 0; x < w; x += w / 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }

  if (player.playing && player.analyser) {
    // spectrum
    player.analyser.getByteFrequencyData(freqData);
    const bars = 96;
    for (let b = 0; b < bars; b++) {
      const lo = Math.floor(2 ** (b / bars * 9.5)), hi = Math.max(lo + 1, Math.floor(2 ** ((b + 1) / bars * 9.5)));
      let v = 0;
      for (let k = lo; k < hi && k < freqData.length; k++) v = Math.max(v, freqData[k]);
      const bh = (v / 255) * h * 0.55;
      g.fillStyle = `hsla(${190 + b * 1.4}, 100%, 60%, 0.22)`;
      g.fillRect(b * (w / bars) + 1, h - bh, w / bars - 2, bh);
    }
    // oscilloscope
    player.analyser.getFloatTimeDomainData(timeData);
    let start = 0;
    for (let k = 1; k < 1024; k++) if (timeData[k - 1] < 0 && timeData[k] >= 0) { start = k; break; }
    g.strokeStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 14;
    g.lineWidth = 2.5 * (w / scope.clientWidth);
    g.beginPath();
    for (let k = 0; k < 1024; k++) {
      const x = (k / 1023) * w;
      const y = h * 0.5 - timeData[start + k] * h * 0.38;
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    g.shadowBlur = 0;

    // playheads, meters, clock
    const pos = player.position;
    const spb = 60 / song.bpm;
    const led = Math.floor(pos / (spb / 4)) % 16;
    if (led !== lastLed) {
      leds.children[lastLed]?.classList.remove('on');
      leds.children[led]?.classList.add('on');
      lastLed = led;
    }
    $('#clock').value = `${Math.floor(pos / 60)}:${(pos % 60).toFixed(1).padStart(4, '0')}`;
    strips.forEach((s, i) => {
      const len = s.length || 1;
      const k = Math.floor(pos / (spb / (s.track.rate ?? 4))) % len;
      if (s.now !== k) { s.pads?.[s.now]?.classList.remove('now'); s.pads?.[k]?.classList.add('now'); s.now = k; }
      const stem = player.stems?.[stemIndex[i]];
      let rms = 0;
      if (stem) {
        const c = Math.floor(pos * player.ctx.sampleRate);
        for (let j = Math.max(0, c - 1024); j < Math.min(stem.length, c + 1024); j += 4) rms += stem[j] * stem[j];
        rms = Math.sqrt(rms / 512);
      }
      s.vu.style.width = `${Math.min(100, rms * 260)}%`;
    });
  } else {
    // idle: the selected equation's shape, breathing
    const t = song.tracks[selected];
    if (t && !problem(t)) {
      const s = voiceSamples(t, 600, { drums: 0.4, fx: 0.4, bass: 0.05, keys: 0.03, pads: 0.03 }[kindOf(t)]);
      const breathe = 0.85 + 0.15 * Math.sin(performance.now() / 600);
      g.strokeStyle = color;
      g.globalAlpha = 0.55;
      g.shadowColor = color;
      g.shadowBlur = 12;
      g.lineWidth = 2 * (w / scope.clientWidth);
      g.beginPath();
      for (let k = 0; k < s.length; k++) {
        const x = (k / (s.length - 1)) * w;
        const y = h * 0.55 - s[k] * h * 0.3 * breathe;
        k ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
      g.globalAlpha = 1;
      g.shadowBlur = 0;
    }
  }
}

// --- Transport and actions ---------------------------------------------------------

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}

async function play() {
  await player.play(playable());
  player.volume = +$('#volume').value;
  $('#play').classList.add('on');
  $('#play').setAttribute('aria-label', 'Playing');
  $('#hint').hidden = true;
}
function stop() {
  player.stop();
  $('#play').classList.remove('on');
  $('#play').setAttribute('aria-label', 'Play');
  strips.forEach((s) => { s.pads?.[s.now]?.classList.remove('now'); s.now = -1; s.vu.style.width = '0'; });
  leds.children[lastLed]?.classList.remove('on');
  lastLed = -1;
}

$('#play').addEventListener('click', () => (player.playing ? player.update(playable(), true) : play()));
$('#stop').addEventListener('click', stop);
$('#volume').addEventListener('input', (e) => { player.volume = +e.target.value; });
$('#bpm').addEventListener('change', (e) => { song.bpm = num(e.target.value, 40, 220, 120); e.target.value = song.bpm; changed({ now: true }); });
$('#bars').addEventListener('change', (e) => { song.bars = +e.target.value; changed({ now: true }); });
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

$('#random').addEventListener('click', () => { song.tracks.forEach(shuffle); rebuild(); changed({ now: true }); });

$('#export').addEventListener('click', () => {
  const { left, right, sampleRate } = renderSong(playable(), { sampleRate: 44100 });
  const url = URL.createObjectURL(new Blob([toWav(left, right, sampleRate)], { type: 'audio/wav' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `equalizer-${(song.title || 'beat').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.wav`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('WAV exported');
});

const b64 = {
  encode: (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))),
};
$('#share').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#s=${b64.encode(JSON.stringify(song))}`;
  history.replaceState(null, '', url);
  try { await navigator.clipboard.writeText(url); toast('Link copied: anyone can open your beat'); }
  catch { window.prompt('Copy this link to share your beat:', url); }
});

function load(s) {
  song = sanitize(s);
  selected = 0;
  rebuild();
}

// --- Cheat sheet ---------------------------------------------------------------------

const vars = $('#vars');
for (const [k, v] of Object.entries(VARIABLES)) {
  const dt = document.createElement('dt'); dt.textContent = k;
  const dd = document.createElement('dd'); dd.textContent = v;
  vars.append(dt, dd);
}
$('#fns').textContent = [...Object.keys(FUNCTIONS), ...Object.keys(CONSTANTS)].join(' ');

// --- Start ---------------------------------------------------------------------------

let initial = null;
if (location.hash.startsWith('#s=')) {
  try {
    initial = JSON.parse(b64.decode(location.hash.slice(3)));
    songPick.add(new Option('Shared beat', 'shared'));
    songPick.value = 'shared';
  } catch { toast("That share link couldn't be read"); }
}
if (!initial) { try { initial = JSON.parse(localStorage.getItem('eq-song')); } catch {} }
load(initial ?? structuredClone(SONGS.house));
if (!initial) songPick.value = 'house';
fitCanvas();
requestAnimationFrame(frame);
