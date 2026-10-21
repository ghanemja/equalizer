// Read math the way people write it (Desmos, Wolfram, LaTeX, textbooks, chat answers) and turn it
// into equalizer's syntax:
//
//   readMath('y = e^{-3t} \\sin(2\\pi f t)')  ->  'E^(-3*tau)*sin(2*PI*f*tau)'
//   readMath('sin(2πft)·e^(−4x)')             ->  'sin(2*PI*f*tau)*E^(-4*tau)'
//
// The result is still just text for compile(), so the whitelisted parser has the final word on
// what can run. Nothing here evaluates anything.

import { FUNCTIONS, CONSTANTS, VARIABLES } from './equalizer.js';

const has = (obj, key) => Object.hasOwn(obj, key);

const UNICODE = {
  '−': '-', '–': '-', '—': '-', '×': '*', '·': '*', '⋅': '*', '∙': '*', '∗': '*', '÷': '/',
  'π': ' pi ', 'τ': ' tau ', '√': ' sqrt ', '≤': '<=', '≥': '>=', '≠': '!=',
};
// Greek letters become their names: knobs (λ -> lambda), except ω, the angular frequency 2πf.
const GREEK = {
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon', 'ζ': 'zeta', 'η': 'eta', 'θ': 'theta', 'ϑ': 'theta',
  'κ': 'kappa', 'λ': 'lambda', 'μ': 'mu', 'ν': 'nu', 'ξ': 'xi', 'ρ': 'rho', 'σ': 'sigma', 'φ': 'phi', 'ϕ': 'phi', 'ψ': 'psi', 'ω': 'omega',
};
const SUPERSCRIPT = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+', '⋅': '.' };
const ALIASES = { pi: 'PI', Pi: 'PI', e: 'E', ln: 'log', arcsin: 'asin', arccos: 'acos', arctan: 'atan', sgn: 'sign', omega: '(2*PI*f)', varphi: 'phi', vartheta: 'theta' };

/** Turn `\frac{a}{b}` (with nested braces) into `((a)/(b))`. */
function latexFractions(s) {
  for (let guard = 0; guard < 50; guard++) {
    const at = s.indexOf('\\frac');
    if (at < 0) return s;
    const group = (from) => {
      let i = from;
      while (s[i] === ' ') i++;
      if (s[i] !== '{') return [s[i] ?? '', i + 1];      // \frac12 style: single characters
      let depth = 0;
      for (let j = i; j < s.length; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1];
      }
      return [s.slice(i + 1), s.length];
    };
    const [num, afterNum] = group(at + 5);
    const [den, afterDen] = group(afterNum);
    s = `${s.slice(0, at)}((${num})/(${den}))${s.slice(afterDen)}`;
  }
  return s;
}

const TOKEN = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(&&|\|\||[<>=!]=|\*\*|[-+*/%^(),?:<>!]))/y;

function tokens(src) {
  const out = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < src.length) {
    if (/^\s*$/.test(src.slice(TOKEN.lastIndex))) break;
    const at = TOKEN.lastIndex;
    const m = TOKEN.exec(src);
    if (!m) { out.push({ type: 'bad', value: src.slice(at).trim()[0] }); TOKEN.lastIndex = at + src.slice(at).search(/\S/) + 1; continue; }
    if (m[1] !== undefined) out.push({ type: 'num', value: m[1] });
    else if (m[2] !== undefined) out.push({ type: 'id', value: m[2] });
    else out.push({ type: 'op', value: m[3] === '**' ? '^' : m[3] });
  }
  return out;
}

/**
 * Split a run of letters like "ft" or "pift" into known names ("f", "t" / "pi", "f", "t").
 * Returns null if it can't be split entirely into known names.
 */
function split(word, known) {
  const best = new Array(word.length + 1).fill(null);
  best[0] = [];
  for (let i = 0; i < word.length; i++) {
    if (!best[i]) continue;
    for (let j = word.length; j > i; j--) {
      const part = word.slice(i, j);
      if (known.has(part) && (!best[j] || best[j].length > best[i].length + 1)) best[j] = [...best[i], part];
    }
  }
  return best[word.length];
}

/**
 * Convert human-written math to equalizer syntax.
 * paramNames: names that already mean something for this sound (its knobs), so they aren't split.
 * Returns { equation, notes } where notes explain any guesses (like reading t as tau).
 */
export function readMath(input, paramNames = []) {
  let s = String(input ?? '').trim();
  const notes = [];

  // Unicode math symbols and superscripts (x² -> x^(2)).
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, (run) => `^(${[...run].map((c) => SUPERSCRIPT[c]).join('')})`);
  s = s.replace(/[−–—×·⋅∙∗÷πτ√≤≥≠]/g, (c) => UNICODE[c]);
  s = s.replace(/[αβγδεζηθϑκλμνξρσφϕψω]/g, (c) => ` ${GREEK[c]} `);

  // Wrappers people copy along with the math: LaTeX delimiters, "graph", "=" (spreadsheets),
  // code prefixes (math.sin, np.sin, Math.sin), and trailing results or conditions.
  s = s.replace(/^\s*(\$\$?|\\\(|\\\[)/, '').replace(/(\$\$?|\\\)|\\\])\s*$/, '')
    .replace(/^\s*(graph|plot|draw)\s+/i, '')
    .replace(/^\s*=/, '')
    .replace(/\b(math|Math|np|numpy|torch|jnp)\./g, '')
    .replace(/\b(PI|pi|Pi)\(\s*\)/g, 'pi')
    .replace(/\s*(≈|~=|\\approx)[^]*$/, '')
    .replace(/\s+(for|where|when|with)\s+[^]*$/i, '');

  // LaTeX.
  s = s.replace(/\$/g, '')
    .replace(/\\(left|right|big|Big|bigg|Bigg)\b/g, '')
    .replace(/\\[,;:! ]/g, ' ')
    .replace(/\\(cdot|times|ast)(?![A-Za-z])/g, '*')
    .replace(/\\div(?![A-Za-z])/g, '/')
    .replace(/\\(operatorname|mathrm|text|textrm)\s*\{([A-Za-z]+)\}/g, ' $2 ');
  s = latexFractions(s);
  s = s.replace(/\\([A-Za-z]+)/g, ' $1 ').replace(/[{[]/g, '(').replace(/[}\]]/g, ')');

  // "y = ...", "f(x) = ...", "s(t)=..." at the front.
  s = s.replace(/^\s*[A-Za-z]\w*\s*(\([^()]*\))?\s*=(?!=)/, '');

  // |x| -> abs(x), unless the text uses || as "or".
  if (!s.includes('||')) for (let g = 0; g < 10 && /\|[^|]*\|/.test(s); g++) s = s.replace(/\|([^|]*)\|/, 'abs($1)');

  // Tokens, with aliases and split-up variable runs like "ft".
  const known = new Set([...Object.keys(VARIABLES), ...Object.keys(CONSTANTS), ...Object.keys(ALIASES), 'x', ...paramNames]);
  let toks = [];
  for (let tok of tokens(s)) {
    // Capitalised function names (Wolfram's Sin[...], Excel's SIN(...)) are the same functions.
    if (tok.type === 'id' && !known.has(tok.value) && !has(FUNCTIONS, tok.value)) {
      const lower = tok.value.toLowerCase();
      if (has(FUNCTIONS, lower) || (has(ALIASES, lower) && lower !== 'e')) tok = { ...tok, value: lower };
    }
    if (tok.type !== 'id' || known.has(tok.value) || has(FUNCTIONS, tok.value)) { toks.push(tok); continue; }
    const parts = tok.value.length <= 5 && /^[A-Za-z]+$/.test(tok.value) ? split(tok.value, known) : null;
    if (parts && parts.length > 1) for (const p of parts) toks.push({ type: 'id', value: p });
    else toks.push(tok);
  }
  toks = toks.map((tok) => (tok.type === 'id' && has(ALIASES, tok.value) && !paramNames.includes(tok.value) ? { ...tok, value: ALIASES[tok.value] } : tok));

  // x is time; so is t when the equation doesn't also use tau (a pasted formula's t means "since the note started").
  const ids = new Set(toks.filter((t) => t.type === 'id').map((t) => t.value));
  const timeNames = ids.has('tau') ? ['x'] : ['x', 't'];
  if (timeNames.some((n) => ids.has(n) && !paramNames.includes(n))) {
    toks = toks.map((tok) => (tok.type === 'id' && timeNames.includes(tok.value) && !paramNames.includes(tok.value) ? { ...tok, value: 'tau' } : tok));
    notes.push(`${timeNames.filter((n) => ids.has(n)).join(' and ')} read as τ, the time since the note started`);
  }

  const isFn = (tok) => tok?.type === 'id' && has(FUNCTIONS, tok.value);
  const operand = (tok) => tok && (tok.type === 'num' || (tok.type === 'id' && !isFn(tok)));

  // Functions written without brackets: "sin 2x" -> "sin(2x)".
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    out.push(tok);
    if (isFn(tok) && toks[i + 1] && !(toks[i + 1].type === 'op' && toks[i + 1].value === '(')) {
      out.push({ type: 'op', value: '(' });
      let j = i + 1;
      while (j < toks.length && (operand(toks[j]) || (toks[j].type === 'op' && toks[j].value === '^' && operand(toks[j + 1])))) out.push(toks[j++]);
      out.push({ type: 'op', value: ')' });
      i = j - 1;
    }
  }

  // Implied multiplication: 2x, 2(x+1), (a)(b), x(y), f t.
  const result = [];
  for (let i = 0; i < out.length; i++) {
    const prev = result[result.length - 1], tok = out[i];
    const prevEnds = prev && (operand(prev) || (prev.type === 'op' && prev.value === ')'));
    const tokStarts = tok.type === 'num' || tok.type === 'id' || (tok.type === 'op' && tok.value === '(');
    if (prevEnds && tokStarts && !(prev.type === 'num' && tok.type === 'num')) result.push({ type: 'op', value: '*' });
    result.push(tok);
  }

  // Back to text: compact, with spaces around + and - between terms.
  let text = '';
  result.forEach((tok, i) => {
    const prev = result[i - 1];
    const binary = tok.type === 'op' && (tok.value === '+' || tok.value === '-') && prev && (operand(prev) || prev.value === ')');
    if (binary || (tok.type === 'op' && ['&&', '||', '<', '>', '<=', '>=', '==', '!=', '?', ':'].includes(tok.value))) text += ` ${tok.value} `;
    else if (tok.type === 'op' && tok.value === ',') text += ', ';
    else text += tok.value;
  });
  return { equation: text.trim(), notes };
}
