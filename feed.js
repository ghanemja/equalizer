// Live feed: post beats and hear what everyone else is making.
// Talks to Supabase directly (REST for reading and posting, a websocket for live updates), so the
// studio needs no SDK and no build step. Database setup: supabase/schema.sql.
//
// The publishable key below is meant to be public: the database only lets visitors read beats,
// post new ones, like and report. Nobody can edit or delete anything from a browser.

const SUPABASE_URL = 'https://pkusxifwwlvlhywptxsu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_tIVxbns_NyM9ZFddo9qqNw_Si6Qvv2A';
const COLUMNS = 'id,created_at,title,author,song,likes';
const PAGE = 20;
const POLL_MS = 30000;
const COLORS = ['#ff3cac', '#ffb020', '#00e5ff', '#9d7bff', '#b6ff3c'];

async function api(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.message || `The feed answered ${res.status}`);
  return data;
}

const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
};

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * deps: { h, toast, getSong, loadBeat(song, beat), slim }
 */
export function initFeed({ h, toast, getSong, loadBeat, slim }) {
  const list = document.getElementById('feed-list');
  const status = document.getElementById('feed-status');
  const more = document.getElementById('feed-more');
  const dialog = document.getElementById('post-dialog');
  const form = document.getElementById('post-form');
  const postError = document.getElementById('post-error');
  const submit = document.getElementById('post-submit');
  const titleIn = document.getElementById('post-title');
  const authorIn = document.getElementById('post-author');

  const beats = new Map();          // id -> { beat, el }
  const liked = new Set(store.get('eq-liked', []));
  let oldest = null;
  let current = null;

  const setStatus = (text, live = false) => {
    status.textContent = text;
    status.classList.toggle('live', live);
  };

  // --- Rendering ---------------------------------------------------------------------
  function render(beat) {
    const color = COLORS[parseInt(beat.id.replace(/-/g, '').slice(-4), 16) % COLORS.length];
    const bpm = Number(beat.song?.bpm) || '';
    const likeBtn = h('button', { class: `feed-like${liked.has(beat.id) ? ' on' : ''}`, 'aria-label': `Like ${beat.title}` });
    const paintLike = () => {
      likeBtn.textContent = `♥ ${beat.likes}`;
      likeBtn.classList.toggle('on', liked.has(beat.id));
      likeBtn.title = liked.has(beat.id) ? 'You liked this' : 'Like';
    };
    paintLike();
    likeBtn.addEventListener('click', async () => {
      if (liked.has(beat.id)) return;
      liked.add(beat.id);
      store.set('eq-liked', [...liked].slice(-500));
      beat.likes += 1;
      paintLike();
      try { const n = await api('rpc/like_beat', { method: 'POST', body: { beat_id: beat.id } }); if (typeof n === 'number') { beat.likes = n; paintLike(); } }
      catch { /* keep the optimistic like; it is only a counter */ }
    });
    const report = h('button', { class: 'feed-report', title: 'Report this beat', 'aria-label': `Report ${beat.title}`, text: '⚑' });
    report.addEventListener('click', async () => {
      if (!confirm(`Report "${beat.title}"? Beats with 3 reports are hidden.`)) return;
      try { await api('rpc/report_beat', { method: 'POST', body: { beat_id: beat.id } }); toast('Thanks, reported'); report.disabled = true; }
      catch (e) { toast(e.message); }
    });
    const when = h('time', { datetime: beat.created_at, text: ago(beat.created_at) });
    const play = h('button', { class: 'feed-play', title: `Load "${beat.title}" and play it`, onclick: () => open(beat) },
      h('span', { class: 'feed-dot', style: `--c: ${color}` }),
      h('span', { class: 'feed-text' },
        h('b', { text: beat.title }),
        h('small', {}, `by ${beat.author} · `, when, bpm ? ` · ${bpm} bpm` : '')));
    const el = h('li', { class: 'feed-item' }, play, likeBtn, report);
    el.when = when;
    return el;
  }

  function add(beat, { top = false, fresh = false } = {}) {
    if (!beat?.id || beats.has(beat.id)) return;
    const el = render(beat);
    beats.set(beat.id, { beat, el });
    if (fresh) { el.classList.add('fresh'); setTimeout(() => el.classList.remove('fresh'), 2500); }
    if (top) list.prepend(el); else list.append(el);
    if (!oldest || beat.created_at < oldest) oldest = beat.created_at;
    document.getElementById('feed-empty')?.remove();
  }

  function open(beat) {
    loadBeat(beat.song, beat);
    beats.get(current)?.el.classList.remove('on');
    current = beat.id;
    beats.get(current)?.el.classList.add('on');
  }

  setInterval(() => { for (const { beat, el } of beats.values()) el.when.textContent = ago(beat.created_at); }, 60000);

  // --- Loading -----------------------------------------------------------------------
  async function loadPage(before) {
    const filter = before ? `&created_at=lt.${encodeURIComponent(before)}` : '';
    const rows = await api(`beats?select=${COLUMNS}&order=created_at.desc&limit=${PAGE}${filter}`);
    for (const row of rows) add(row);
    more.hidden = rows.length < PAGE;
    if (!beats.size && !document.getElementById('feed-empty')) {
      list.append(h('li', { class: 'feed-empty', id: 'feed-empty', text: 'No beats yet. Be the first to post one!' }));
    }
  }

  async function refreshTop() {
    const rows = await api(`beats?select=${COLUMNS}&order=created_at.desc&limit=${PAGE}`);
    for (const row of rows.reverse()) add(row, { top: true, fresh: beats.size > 0 });
  }

  more.addEventListener('click', async () => {
    more.disabled = true;
    try { await loadPage(oldest); } catch (e) { toast(e.message); }
    more.disabled = false;
  });

  // --- Live updates (Supabase Realtime over a websocket), polling as the fallback -------
  let ws = null, heartbeat = 0, poll = 0, ref = 0, retry = 0;

  function startPolling() {
    if (poll) return;
    setStatus('Updates every 30 seconds');
    poll = setInterval(() => refreshTop().catch(() => {}), POLL_MS);
  }
  function stopPolling() { clearInterval(poll); poll = 0; }

  function connect() {
    if (ws || document.hidden) return;
    const url = `${SUPABASE_URL.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(SUPABASE_KEY)}&vsn=1.0.0`;
    let joined = false;
    try { ws = new WebSocket(url); } catch { startPolling(); return; }
    const send = (msg) => ws?.readyState === 1 && ws.send(JSON.stringify({ ...msg, ref: String(++ref) }));
    const joinTimer = setTimeout(() => { if (!joined) startPolling(); }, 8000);
    ws.onopen = () => {
      send({
        topic: 'realtime:public:beats', event: 'phx_join', join_ref: '1',
        payload: { config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: [{ event: 'INSERT', schema: 'public', table: 'beats' }] } },
      });
      heartbeat = setInterval(() => send({ topic: 'phoenix', event: 'heartbeat', payload: {} }), 25000);
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.event === 'phx_reply' && msg.topic === 'realtime:public:beats') {
        if (msg.payload?.status === 'ok') { joined = true; retry = 0; stopPolling(); setStatus('Live', true); }
        else startPolling();
      } else if (msg.event === 'system' && msg.payload?.status === 'error') {
        startPolling();
      } else if (msg.event === 'postgres_changes' && msg.payload?.data?.type === 'INSERT') {
        const r = msg.payload.data.record;
        if (r && !r.hidden) add({ id: r.id, created_at: r.created_at, title: r.title, author: r.author, song: r.song, likes: r.likes ?? 0 }, { top: true, fresh: true });
      }
    };
    ws.onclose = () => {
      clearTimeout(joinTimer);
      clearInterval(heartbeat);
      ws = null;
      if (document.hidden) return;
      startPolling();
      // Try the live connection again, backing off up to a couple of minutes.
      setTimeout(connect, Math.min(120000, 5000 * 2 ** retry++));
    };
  }

  // Free the live connection while the tab is in the background.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { ws?.close(); stopPolling(); }
    else { refreshTop().catch(() => {}); connect(); }
  });

  // --- Posting -----------------------------------------------------------------------
  document.getElementById('post-btn').addEventListener('click', () => {
    const song = getSong();
    titleIn.value = song.title && !/^(Shared beat|From the feed|Blank)/.test(song.title) ? song.title : '';
    authorIn.value = store.get('eq-author', '');
    postError.textContent = '';
    dialog.showModal();
    (titleIn.value ? authorIn : titleIn).focus();
  });
  form.addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'post') return;           // Cancel closes the dialog as usual
    e.preventDefault();
    const title = titleIn.value.trim(), author = authorIn.value.trim();
    if (!title || !author) { postError.textContent = 'Give it a title and your name.'; return; }
    store.set('eq-author', author);
    submit.disabled = true;
    postError.textContent = '';
    try {
      const [beat] = await api(`beats?select=${COLUMNS}`, { method: 'POST', prefer: 'return=representation', body: { title, author, song: slim(getSong()) } });
      add(beat, { top: true, fresh: true });
      current = beat.id;
      beats.get(current)?.el.classList.add('on');
      dialog.close();
      toast('Posted to the live feed');
      document.getElementById('feed').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      postError.textContent = /Failed to fetch|NetworkError/i.test(err.message) ? "Couldn't reach the feed. Check your connection and try again." : err.message;
    } finally {
      submit.disabled = false;
    }
  });

  // --- Start -------------------------------------------------------------------------
  setStatus('Loading…');
  loadPage()
    .then(() => { setStatus(''); connect(); })
    .catch(() => {
      setStatus("The feed isn't available right now. You can still make and share beats.");
      list.textContent = '';
      document.getElementById('post-btn').disabled = true;
      setTimeout(() => loadPage().then(() => { setStatus(''); document.getElementById('post-btn').disabled = false; connect(); }).catch(() => {}), 60000);
    });
}
