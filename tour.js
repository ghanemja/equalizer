// A light-up tour of the studio: dims the page, spotlights one control at a time and explains it.
// Shown once on a visitor's first visit (after the beat starts); "?" replays it; Skip ends it.

const STEPS = [
  { sel: '#play', title: 'Play and stop', text: 'Your beat is playing. Tap here, or press space, to stop and start it.' },
  { sel: '.lcd.song', title: 'Pick a song', text: 'Every song here is built from math. Try a few, then make one your own.' },
  { sel: '.track .cells', title: 'Tap squares to make a beat', text: 'Lit squares play. Tap any square to add or remove a hit.' },
  { sel: '.track .row-name', title: 'Open a sound', text: "Tap a sound's name to open its panel: its equation and its knobs." },
  { sel: '#inspector .insp-card', title: 'Every knob is a number', text: 'Turn a knob and you change a number in the equation. You can also edit the math itself.' },
  { sel: '.rhythm-presets', title: 'Let math write the rhythm', text: 'Euclidean, Fibonacci, the golden ratio: one tap fills the row with a rhythm made from math.' },
  { sel: '#beats', title: 'Change the feel', text: '3 beats per bar makes a waltz. 3 squares per beat makes triplets, a swingy shuffle.', target: (el) => el.closest('.lcd') },
  { sel: '.lab', title: 'Paste any math', text: 'Paste a formula from Wolfram Alpha, Desmos, ChatGPT or a textbook and hear what it sounds like.' },
  { sel: '#feed', title: 'Share it', text: 'Post your beat to the live feed, or tap Share to send a link. Have fun!' },
];
const STORAGE = 'eq-tour';

export function tourSeen() {
  try { return localStorage.getItem(STORAGE) === 'done'; } catch { return false; }
}

export function startTour() {
  if (document.querySelector('.tour')) return;
  const steps = STEPS.map((s) => {
    const el = document.querySelector(s.sel);
    return el && { ...s, el: s.target ? s.target(el) : el };
  }).filter((s) => s && s.el.getClientRects().length);
  if (!steps.length) return;

  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = `
    <div class="tour__hole"></div>
    <div class="tour__card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text">
      <div class="tour__count"></div>
      <h2 class="tour__title" id="tour-title"></h2>
      <p class="tour__text" id="tour-text"></p>
      <div class="tour__dots" aria-hidden="true"></div>
      <div class="tour__buttons">
        <button class="tour__skip" type="button">Skip tour</button>
        <span></span>
        <button class="tour__back" type="button">Back</button>
        <button class="tour__next" type="button">Next</button>
      </div>
    </div>`;
  document.body.append(root);
  const hole = root.querySelector('.tour__hole');
  const card = root.querySelector('.tour__card');
  const $ = (c) => root.querySelector(c);
  const dots = $('.tour__dots');
  dots.append(...steps.map(() => document.createElement('i')));
  let i = 0;

  const place = () => {
    const r = steps[i].el.getBoundingClientRect();
    const pad = 8;
    // Clip to the screen: some targets (the grid on a phone) are wider than the viewport.
    const x0 = Math.max(4, r.left - pad), x1 = Math.min(innerWidth - 4, r.right + pad);
    Object.assign(hole.style, { left: `${x0}px`, top: `${r.top - pad}px`, width: `${x1 - x0}px`, height: `${r.height + pad * 2}px` });
    // The card goes below the spotlight if there's room, else above, else over the bottom of the screen.
    const cw = card.offsetWidth, ch = card.offsetHeight, vw = innerWidth, vh = innerHeight, gap = 16;
    let top = r.bottom + pad + gap;
    if (top + ch > vh - 12) top = r.top - pad - gap - ch;
    if (top < 12) top = vh - ch - 16;
    const left = Math.min(vw - cw - 12, Math.max(12, r.left + r.width / 2 - cw / 2));
    Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
  };
  const show = (n) => {
    i = Math.max(0, Math.min(steps.length - 1, n));
    const s = steps[i];
    $('.tour__count').textContent = `${i + 1} of ${steps.length}`;
    $('.tour__title').textContent = s.title;
    $('.tour__text').textContent = s.text;
    $('.tour__back').hidden = i === 0;
    $('.tour__next').textContent = i === steps.length - 1 ? 'Done' : 'Next';
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    const r = s.el.getBoundingClientRect();
    if (r.top < 80 || r.bottom > innerHeight - 40) s.el.scrollIntoView({ block: 'center', behavior: 'instant' });
    place();
    $('.tour__next').focus({ preventScroll: true });
  };
  const end = () => {
    try { localStorage.setItem(STORAGE, 'done'); } catch {}
    removeEventListener('resize', place);
    removeEventListener('scroll', place, true);
    document.removeEventListener('keydown', onKey, true);
    root.classList.add('tour--out');
    setTimeout(() => root.remove(), 250);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); end(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); i === steps.length - 1 ? end() : show(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); show(i - 1); }
    else if (e.key === ' ') e.stopPropagation();     // don't toggle play from behind the tour
  };
  $('.tour__skip').addEventListener('click', end);
  $('.tour__back').addEventListener('click', () => show(i - 1));
  $('.tour__next').addEventListener('click', () => (i === steps.length - 1 ? end() : show(i + 1)));
  addEventListener('resize', place);
  addEventListener('scroll', place, true);
  document.addEventListener('keydown', onKey, true);
  show(0);
}
