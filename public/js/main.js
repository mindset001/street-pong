import { Scene } from './scene.js';
import { sfx } from './audio.js';
import { Voice } from './voice.js';

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
}
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};
function toast(msg, kind = '', action) {
  const t = el('div', { class: `toast ${kind}` }, msg);
  if (action) t.append(el('div', {}, el('button', { class: 'alt', onclick: () => { action.fn(); t.remove(); } }, action.label)));
  $('#toasts').append(t);
  setTimeout(() => t.remove(), action ? 15000 : 4500);
}
const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// ---------- state ----------
const S = { token: store.get('token'), user: null, game: null, level: 'medium', lobby: { online: 0, playing: 0, queued: 0 } };
const scene = new Scene($('#gl'));

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && S.token && !path.startsWith('/auth/')) { logout(); throw new Error('Session expired'); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- websocket ----------
let ws, retry = 0, wsTimer;
function connect() {
  clearTimeout(wsTimer);
  if (!S.token) return;
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', token: S.token }));
  ws.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose = (e) => {
    $('#net-dot').classList.remove('on'); voice.leave(false);
    if (e.code === 4002) return logout();
    if (e.code === 4003) return; // replaced by a newer tab, don't fight it
    if (S.token) wsTimer = setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
  };
}
const send = (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m));
const voice = new Voice(send, () => renderVoice(), (m) => toast(m, 'bad'));

function onMsg(m) {
  switch (m.t) {
    case 'hello': retry = 0; $('#net-dot').classList.add('on'); S.lobby = m; updateLobbyStats(); break;
    case 'lobby': S.lobby = m; updateLobbyStats(); break;
    case 'err': toast(m.msg, 'bad'); break;
    case 'queued': showSearching(); break;
    case 'unqueued': closeModal(); break;
    case 'start': startGame(m); break;
    case 's': onSnapshot(m); break;
    case 'over': endGame(m); break;
    case 'chat': addChat(m); break;
    case 'muted': onMuted(m); break;
    case 'unwatched': leaveGameView(); break;
    case 'voice_peers': case 'voice_joined': case 'voice_left': case 'voice_closed': case 'rtc': voice.handle(m); break;
    case 'comp': if (current.compId === m.id) renderRoute(); break;
    case 'comp_match':
      toast(`Your match in “${m.name}” is ready!`, 'good', { label: 'Go to bracket', fn: () => { location.hash = `#/competition/${m.compId}`; } });
      sfx.point(true);
      break;
  }
}
async function loadLive() {
  const box = $('#live'); if (!box) return;
  try {
    const { games } = await api('/live');
    box.replaceChildren(...(games.length ? games.map((g) => el('div', { class: 'live' },
      el('div', {}, el('b', {}, `${g.players[0]} vs ${g.players[1]}`), ' ', el('span', { class: 'sc' }, `${g.score[0]}–${g.score[1]}`),
        el('div', { class: 'dim', style: 'font-size:.85em' }, g.competition ? `🏆 ${g.competition} · ` : 'Ranked · ', `${g.spectators} watching`, g.voice ? ` · 🎙 ${g.voice} in voice` : '')),
      el('button', { class: 'alt', onclick: () => send({ t: 'watch', gid: g.gid }) }, 'Watch'))) : [el('p', { class: 'dim', style: 'margin:0' }, 'No games in progress right now.')]));
  } catch { /* transient */ }
}
function updateLobbyStats() {
  if (S.lobby.playing !== liveSeen && $('#live')) loadLive();
  liveSeen = S.lobby.playing;
  const n = $('#lobby-stats');
  if (n) n.textContent = `${S.lobby.online} online · ${S.lobby.playing} games live · ${S.lobby.queued} searching`;
}

// ---------- auth ----------
function logout() {
  S.token = null; S.user = null; store.set('token', null); ws?.close(); ws = null;
  $('#topbar').hidden = true;
  closeModal(); location.hash = '#/'; renderRoute();
}
$('#logout').onclick = logout;
$('#mute').onclick = () => { sfx.enabled = !sfx.enabled; $('#mute').textContent = sfx.enabled ? '🔊' : '🔈'; };

function authView() {
  let mode = 'login';
  const err = el('p', { class: 'err', role: 'alert' });
  const user = el('input', { autocomplete: 'username', maxlength: 16, placeholder: 'Username', required: true });
  const pass = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password', required: true, maxlength: 72 });
  const submit = el('button', { type: 'submit' }, 'Log in');
  const tabs = ['login', 'register'].map((m) => el('button', { type: 'button', class: m === mode ? 'on' : '', onclick: () => setMode(m) }, m === 'login' ? 'Log in' : 'Create account'));
  function setMode(m) {
    mode = m; err.textContent = '';
    tabs.forEach((t, i) => t.classList.toggle('on', ['login', 'register'][i] === m));
    submit.textContent = m === 'login' ? 'Log in' : 'Create account';
    pass.autocomplete = m === 'login' ? 'current-password' : 'new-password';
  }
  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault(); err.textContent = ''; submit.disabled = true;
      try {
        const r = await api(`/auth/${mode}`, { body: { username: user.value.trim(), password: pass.value } });
        S.token = r.token; S.user = r.user; store.set('token', r.token);
        connect(); if (!location.hash.startsWith('#/join/')) location.hash = '#/'; renderRoute();
      } catch (ex) { err.textContent = ex.message; } finally { submit.disabled = false; }
    },
  },
  el('div', { class: 'tabs' }, tabs),
  el('label', {}, 'Username'), user, el('label', {}, 'Password'), pass, err,
  el('div', { style: 'margin-top:10px' }, submit));
  submit.style.width = '100%';
  return el('div', { class: 'panel auth' }, el('div', { class: 'logo' }, 'STREET', el('b', {}, 'PONG')), el('p', { class: 'dim' }, 'Real-time 3D table tennis. Climb the ladder, win tournaments.'), form);
}

// ---------- views ----------
let liveSeen = -1;
const current = { compId: null };

function homeView() {
  const u = S.user;
  const level = el('select', { onchange: (e) => { S.level = e.target.value; } },
    ['easy', 'medium', 'hard'].map((l) => el('option', { value: l, selected: l === S.level }, l[0].toUpperCase() + l.slice(1))));
  return el('div', { class: 'wrap' },
    el('div', { class: 'panel', style: 'margin-bottom:16px' },
      el('div', { class: 'row between' },
        el('div', {}, el('h1', {}, `Welcome, ${u.username}`), el('p', { class: 'dim', id: 'lobby-stats', style: 'margin:0' })),
        el('div', { class: 'stat' },
          el('div', {}, el('b', {}, u.rating), el('span', {}, 'Rating')),
          el('div', {}, el('b', {}, `${u.wins}–${u.losses}`), el('span', {}, 'W–L')),
          el('div', {}, el('b', {}, u.titles), el('span', {}, 'Titles'))))),
    el('div', { class: 'grid' },
      el('div', { class: 'panel card' }, el('h2', {}, 'Quick match'), el('p', {}, 'Ranked game against another player. Winner takes rating points.'),
        el('div', { class: 'actions' }, el('button', { onclick: () => send({ t: 'queue' }) }, 'Find opponent'))),
      el('div', { class: 'panel card' }, el('h2', {}, 'Practice vs CPU'), el('p', {}, 'Warm up against the machine. Unranked.'),
        el('div', { class: 'actions' }, level, el('button', { class: 'alt', onclick: () => send({ t: 'ai', level: S.level }) }, 'Play'))),
      el('div', { class: 'panel card' }, el('h2', {}, 'Competitions'), el('p', {}, 'Create or join a knockout bracket and fight for the title.'),
        el('div', { class: 'actions' }, el('button', { class: 'ghost', onclick: () => { location.hash = '#/competitions'; } }, 'Browse'))),
      el('div', { class: 'panel card' }, el('h2', {}, 'Leaderboard'), el('p', {}, 'See who rules the table.'),
        el('div', { class: 'actions' }, el('button', { class: 'ghost', onclick: () => { location.hash = '#/leaderboard'; } }, 'Rankings'), el('button', { class: 'ghost', onclick: () => profileModal(u.username) }, 'My profile')))),
    el('div', { class: 'panel', style: 'margin-top:16px' }, el('h2', {}, 'Live now'), el('div', { id: 'live' }, el('p', { class: 'dim', style: 'margin:0' }, 'Loading…'))),
    el('div', { class: 'panel', style: 'margin-top:16px' }, el('h3', {}, 'How to play'),
      el('p', { class: 'dim', style: 'margin:0' }, 'Move the mouse (or drag a finger) to steer your paddle. Click or press Space to serve. Let the ball bounce on your side, then meet it with the paddle: a quick swing hits harder and deeper but is less accurate; where the ball meets the paddle steers it left or right. Don’t clip the net, and don’t let it bounce twice. First to 11, win by 2.')));
}

async function leaderboardView(root) {
  let sort = 'rating';
  const body = el('div');
  const tabs = [['rating', 'Rating'], ['wins', 'Wins'], ['titles', 'Titles']].map(([k, label]) => el('button', { class: k === sort ? 'on' : '', onclick: () => { sort = k; tabs.forEach((t, i) => t.classList.toggle('on', i === ['rating', 'wins', 'titles'].indexOf(k))); load(); } }, label));
  async function load() {
    body.replaceChildren(el('p', { class: 'dim' }, 'Loading…'));
    try {
      const { players } = await api(`/leaderboard?sort=${sort}`);
      if (!players.length) return body.replaceChildren(el('p', { class: 'dim' }, 'No ranked games yet. Be the first on the board!'));
      body.replaceChildren(el('div', { class: 'scroll-x' }, el('table', {},
        el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Player'), el('th', { class: 'num' }, 'Rating'), el('th', { class: 'num' }, 'W'), el('th', { class: 'num' }, 'L'), el('th', { class: 'num hide-sm' }, 'Win %'), el('th', { class: 'num' }, '🏆'))),
        el('tbody', {}, players.map((p) => el('tr', { class: p.id === S.user.id ? 'me' : '' },
          el('td', { class: 'medal' }, ['🥇', '🥈', '🥉'][p.rank - 1] || p.rank),
          el('td', {}, el('a', { href: '#', onclick: (e) => { e.preventDefault(); profileModal(p.username); } }, p.username)),
          el('td', { class: 'num' }, p.rating), el('td', { class: 'num' }, p.wins), el('td', { class: 'num' }, p.losses),
          el('td', { class: 'num hide-sm' }, p.games ? `${Math.round((p.wins / p.games) * 100)}%` : '–'), el('td', { class: 'num' }, p.titles || ''))))))); 
    } catch (e) { body.replaceChildren(el('p', { class: 'err' }, e.message)); }
  }
  root.append(el('div', { class: 'wrap' }, el('div', { class: 'panel' }, el('div', { class: 'row between' }, el('h1', {}, 'Leaderboard'), el('div', { class: 'tabs', style: 'margin:0' }, tabs)), body)));
  tabs[0].classList.add('on');
  load();
}

async function profileModal(name) {
  try {
    const d = await api(`/users/${encodeURIComponent(name)}`);
    const u = d.user;
    modal(el('div', { class: 'panel', style: 'text-align:left' },
      el('div', { class: 'row between' }, el('h2', {}, u.username), el('button', { class: 'ghost', onclick: closeModal }, 'Close')),
      el('div', { class: 'stat', style: 'margin:8px 0 14px' },
        el('div', {}, el('b', {}, u.rating), el('span', {}, 'Rating')), el('div', {}, el('b', {}, d.rank ? `#${d.rank}` : '–'), el('span', {}, 'Rank')),
        el('div', {}, el('b', {}, `${u.wins}–${u.losses}`), el('span', {}, 'W–L')), el('div', {}, el('b', {}, u.titles), el('span', {}, 'Titles'))),
      el('h3', {}, 'Recent matches'),
      d.recent.length ? el('table', {}, el('tbody', {}, d.recent.map((m) => el('tr', {},
        el('td', {}, el('b', { style: `color:var(--${m.won ? 'good' : 'bad'})` }, m.won ? 'W' : 'L')),
        el('td', {}, `vs ${m.opponent}`), el('td', { class: 'num' }, `${m.score[0]}–${m.score[1]}`),
        el('td', { class: 'num' }, m.delta ? el('span', { class: `delta ${m.delta > 0 ? 'up' : 'down'}` }, (m.delta > 0 ? '+' : '') + m.delta) : el('span', { class: 'dim' }, m.kind === 'ai' ? 'CPU' : '')),
        el('td', { class: 'num dim' }, fmtDate(m.at)))))) : el('p', { class: 'dim' }, 'No matches yet.')), true);
  } catch (e) { toast(e.message, 'bad'); }
}

async function competitionsView(root) {
  const list = el('div', { class: 'grid' });
  const name = el('input', { maxlength: 40, placeholder: 'e.g. Friday Night Showdown' });
  const size = el('select', {}, [4, 8, 16].map((n) => el('option', { value: n }, `${n} players`)));
  const err = el('p', { class: 'err' });
  async function load() {
    try {
      const { competitions } = await api('/competitions');
      list.replaceChildren(...(competitions.length ? competitions.map((c) => el('div', { class: 'panel card' },
        el('div', { class: 'row between' }, el('h3', { style: 'margin:0' }, c.name), el('span', { class: `pill ${c.status}` }, c.status === 'open' ? 'Open' : c.status === 'running' ? 'In progress' : 'Finished')),
        el('p', {}, `by ${c.creator} · ${c.players}/${c.size} players`, c.champion ? ` · 🏆 ${c.champion}` : ''),
        el('div', { class: 'actions' }, el('button', { class: c.status === 'open' ? '' : 'ghost', onclick: () => { location.hash = `#/competition/${c.id}`; } }, c.status === 'open' ? 'View & join' : 'View bracket')))) : [el('p', { class: 'dim' }, 'No competitions yet — create the first one!')]));
    } catch (e) { list.replaceChildren(el('p', { class: 'err' }, e.message)); }
  }
  current.reload = load;
  const code = el('input', { maxlength: 6, placeholder: 'ABC123', style: 'text-transform:uppercase;letter-spacing:.2em' });
  root.append(el('div', { class: 'wrap' },
    el('div', { class: 'panel', style: 'margin-bottom:16px' }, el('h2', {}, 'Have an invite code?'),
      el('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); location.hash = `#/join/${code.value.trim()}`; } },
        el('div', { style: 'flex:1;min-width:160px' }, code), el('button', { type: 'submit', class: 'alt' }, 'Find competition'))),
    el('div', { class: 'panel', style: 'margin-bottom:16px' }, el('h1', {}, 'Competitions'),
      el('p', { class: 'dim' }, 'Single-elimination brackets. Starts automatically when full, or the creator can start it early (byes fill the gaps).'),
      el('form', { class: 'row', style: 'align-items:flex-end', onsubmit: async (e) => {
        e.preventDefault(); err.textContent = '';
        try { const c = await api('/competitions', { body: { name: name.value, size: Number(size.value) } }); location.hash = `#/competition/${c.id}`; } catch (ex) { err.textContent = ex.message; }
      } }, el('div', { style: 'flex:2;min-width:200px' }, el('label', {}, 'Name'), name), el('div', { style: 'flex:1;min-width:120px' }, el('label', {}, 'Size'), size), el('button', { type: 'submit' }, 'Create')), err),
    list));
  load();
}

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg, 'good'); } catch { prompt('Copy this:', text); }
}
async function shareLink(d) {
  const url = `${location.origin}/#/join/${d.code}`;
  const text = `Join my table tennis competition “${d.name}” on Street Pong (code ${d.code})`;
  if (navigator.share) { try { return await navigator.share({ title: d.name, text, url }); } catch (e) { if (e.name === 'AbortError') return; } }
  copy(url, 'Invite link copied');
}

async function joinByCode(code) {
  try { const { id } = await api(`/competitions/code/${encodeURIComponent(code)}`); location.replace(`#/competition/${id}`); }
  catch (e) { toast(e.message, 'bad'); location.replace('#/competitions'); }
}

async function competitionView(root, id) {
  current.compId = id;
  let d;
  try { d = await api(`/competitions/${id}`); } catch (e) { root.append(el('div', { class: 'wrap' }, el('div', { class: 'panel' }, el('p', { class: 'err' }, e.message), el('a', { href: '#/competitions' }, '← Back')))); return; }
  const me = S.user.id;
  const act = (path, method = 'POST') => async () => {
    try { await api(`/competitions/${id}${path}`, { method }); if (method === 'DELETE') location.hash = '#/competitions'; else renderRoute(); } catch (e) { toast(e.message, 'bad'); }
  };
  const roundName = (i, n) => (i === n - 1 ? 'Final' : i === n - 2 ? 'Semi-finals' : i === n - 3 ? 'Quarter-finals' : `Round ${i + 1}`);
  const matchBox = (m) => {
    const pl = (p, s) => el('div', { class: `pl ${!p ? 'tbd' : m.winner ? (m.winner === p.id ? 'win' : 'lose') : ''}` }, el('span', {}, p ? p.username : m.bye ? 'BYE' : 'TBD'), el('span', {}, m.status === 'done' && !m.bye ? s : ''));
    const mine = (m.p1?.id === me || m.p2?.id === me);
    let foot = null;
    if (m.status === 'ready') {
      const iAmReady = m.ready.includes(me);
      foot = el('div', { class: 'foot' }, el('span', { class: 'dim' }, `${m.ready.length}/2 ready`),
        mine ? (iAmReady ? el('button', { class: 'ghost', onclick: () => send({ t: 'comp_unready', matchId: m.id }) }, 'Waiting… (cancel)') : el('button', { onclick: () => send({ t: 'comp_ready', matchId: m.id }) }, 'Ready — play!')) : null);
    } else if (m.status === 'playing') foot = el('div', { class: 'foot' }, el('span', { style: 'color:var(--accent-2)' }, '● Live'), m.gid && !mine && el('button', { class: 'alt', onclick: () => send({ t: 'watch', gid: m.gid }) }, 'Watch'));
    return el('div', { class: `match ${m.status}` }, pl(m.p1, m.s1), pl(m.p2, m.s2), foot);
  };
  const n = d.rounds.length;
  root.append(el('div', { class: 'wrap' },
    el('div', { class: 'panel' },
      el('div', { class: 'row between' },
        el('div', {}, el('a', { href: '#/competitions' }, '← All competitions'), el('h1', { style: 'margin-top:6px' }, d.name),
          el('p', { class: 'dim', style: 'margin:0' }, `by ${d.creator} · ${d.players.length}/${d.size} players · `, el('span', { class: `pill ${d.status}` }, d.status))),
        el('div', { class: 'row' },
          d.status === 'open' && !d.joined && el('button', { onclick: act('/join') }, 'Join'),
          d.status === 'open' && d.joined && d.creatorId !== me && el('button', { class: 'ghost', onclick: act('/leave') }, 'Leave'),
          d.status === 'open' && d.creatorId === me && el('button', { class: 'alt', disabled: d.players.length < 2, onclick: act('/start') }, 'Start now'),
          d.status === 'open' && d.creatorId === me && el('button', { class: 'danger', onclick: () => confirm('Cancel this competition?') && act('', 'DELETE')() }, 'Cancel'))),
      d.code && d.status === 'open' && el('div', { class: 'row', style: 'margin-top:14px;padding:12px;border:1px dashed var(--line);border-radius:12px' },
        el('span', { class: 'dim' }, 'Invite code'), el('b', { style: 'font-size:1.4rem;letter-spacing:.2em' }, d.code),
        el('button', { class: 'ghost', onclick: () => copy(d.code, 'Code copied') }, 'Copy code'),
        el('button', { class: 'alt', onclick: () => shareLink(d) }, 'Share invite link')),
      d.champion && el('h2', { style: 'margin-top:14px;color:var(--accent)' }, `🏆 Champion: ${d.champion.username}`),
      el('h3', { style: 'margin-top:18px' }, 'Players'),
      el('div', { class: 'row' }, d.players.map((p) => el('span', { class: 'pill' }, `${p.username} · ${p.rating}`)), Array.from({ length: d.size - d.players.length }, () => el('span', { class: 'pill', style: 'opacity:.5' }, 'open slot'))),
      n > 0 && el('h3', { style: 'margin-top:18px' }, 'Bracket'),
      n > 0 && el('div', { class: 'bracket' }, d.rounds.map((r, i) => el('div', { class: 'round' }, el('h4', {}, roundName(i, n)), r.map(matchBox)))),
      d.status === 'running' && el('p', { class: 'dim' }, 'When both players press “Ready”, the match starts. If an opponent doesn’t show within 3 minutes, the ready player advances.'))));
}

// ---------- router ----------
function renderRoute() {
  const view = $('#view');
  current.compId = null; current.reload = null; clearInterval(current.timer);
  view.replaceChildren();
  if (S.game) { view.hidden = true; return; }
  view.hidden = false;
  if (!S.token || !S.user) { $('#topbar').hidden = true; scene.setMode('menu'); view.append(authView()); return; }
  $('#topbar').hidden = false;
  $('#me-link').textContent = `${S.user.username} · ${S.user.rating}`;
  $('#me-link').onclick = (e) => { e.preventDefault(); profileModal(S.user.username); };
  const [, route, arg] = location.hash.split('/');
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (route || 'home') || (a.dataset.nav === 'competitions' && route === 'competition')));
  if (route === 'competitions') competitionsView(view);
  else if (route === 'competition' && Number(arg)) competitionView(view, Number(arg));
  else if (route === 'join' && arg) joinByCode(arg);
  else if (route === 'leaderboard') leaderboardView(view);
  else { view.append(homeView()); updateLobbyStats(); loadLive(); current.timer = setInterval(loadLive, 5000); }
}
addEventListener('hashchange', () => { if (!S.game) renderRoute(); });

// ---------- modal ----------
function modal(content, dismissable = false) {
  const m = $('#modal'); m.replaceChildren(content); m.hidden = false;
  m.onclick = dismissable ? (e) => { if (e.target === m) closeModal(); } : null;
}
function closeModal() { $('#modal').hidden = true; $('#modal').replaceChildren(); }
function showSearching() {
  modal(el('div', { class: 'panel' }, el('h2', {}, 'Searching for an opponent…'), el('p', { class: 'dim' }, 'You’ll be matched with the next player in the queue.'),
    el('button', { class: 'ghost', onclick: () => send({ t: 'unqueue' }) }, 'Cancel')));
}

// ---------- game ----------
const canvas = $('#gl');
let latest = null, lastSent = '', stateNow = 'serve';

function startGame(m) {
  S.game = m; closeModal(); sfx.unlock();
  scene.setMode(m.you < 0 ? 'watch' : 'game', m.you); scene.reset();
  $('#view').hidden = true; $('#topbar').hidden = true; $('#hud').hidden = false; document.body.classList.add('playing');
  const names = m.players.map((p) => p.username);
  document.querySelectorAll('#hud .name').forEach((n, i) => { n.textContent = names[i] + (i === m.you ? ' (you)' : ''); });
  if (!m.resume) voice.leave(true);
  buildChat(m); voice.forced = !!m.muted && !m.host;
  if (m.you < 0) scene.setMode('watch');
  renderVoice();
  $('#hud-p0').classList.toggle('me', m.you === 0); $('#hud-p1').classList.toggle('me', m.you === 1);
  $('#hud-target').textContent = m.target;
  setScore(m.score || [0, 0]); say(m.you < 0 ? `Watching ${names[0]} vs ${names[1]}` : 'Get ready…');
  $('#hud-leave').textContent = m.you < 0 ? 'Stop watching' : m.kind === 'ai' ? 'Quit' : 'Forfeit';
}
function setScore(sc) {
  const pts = document.querySelectorAll('#hud .pts'); pts[0].textContent = sc[0]; pts[1].textContent = sc[1];
}
function say(text, sub) { const n = $('#hud-msg'); n.replaceChildren(text, sub ? el('small', {}, sub) : ''); }

function onSnapshot(s) {
  if (!S.game) return;
  scene.applySnapshot(s); setScore(s.sc);
  const you = S.game.you;
  $('#hud-p0').classList.toggle('serving', s.sv === 0); $('#hud-p1').classList.toggle('serving', s.sv === 1);
  for (const e of s.ev || []) {
    if (e.e === 'hit') sfx.hit(); else if (e.e === 'bounce') sfx.bounce(); else if (e.e === 'net') sfx.net();
    else if (e.e === 'point') { sfx.point(you < 0 || e.p === you); say(you < 0 ? `Point: ${S.game.players[e.p].username}` : e.p === you ? 'Point!' : 'Point to opponent'); }
  }
  stateNow = s.st;
  if (s.st === 'serve') say(you < 0 ? `${S.game.players[s.sv].username} serving` : s.sv === you ? 'Your serve' : 'Opponent serving', s.sv === you ? 'Click or press Space' : '');
  else if (s.st === 'rally' && !(s.ev || []).some((e) => e.e === 'point')) say('');
}

function pointer(e) {
  if (!S.game || S.game.you < 0) return;
  // On touch screens keep the paddle above the fingertip so it stays visible.
  const p = scene.pointerToPaddle(e.clientX, e.clientY - (e.pointerType === 'touch' ? 80 : 0));
  if (p) latest = p;
}
canvas.addEventListener('pointermove', pointer);
canvas.addEventListener('pointerdown', (e) => { pointer(e); if (S.game && S.game.you >= 0) { sfx.unlock(); send({ t: 'serve' }); } });
addEventListener('keydown', (e) => {
  if (S.game && e.key === 'Enter' && !/INPUT|BUTTON|SELECT/.test(e.target.tagName)) { e.preventDefault(); openChat(true); return; }
  if (S.game && S.game.you >= 0 && e.code === 'Space' && !/INPUT|BUTTON/.test(e.target.tagName)) { e.preventDefault(); send({ t: 'serve' }); } });
setInterval(() => {
  if (!S.game || S.game.you < 0 || !latest) return;
  const k = `${latest.x.toFixed(3)},${latest.y.toFixed(3)}`;
  if (k !== lastSent) { lastSent = k; send({ t: 'p', x: latest.x, y: latest.y }); }
}, 16);

$('#hud-leave').onclick = () => { if (S.game?.you < 0) return send({ t: 'unwatch' }); if (confirm(S.game?.kind === 'ai' ? 'Quit this game?' : 'Forfeit this game? It counts as a loss.')) send({ t: 'leave' }); };

function resetChat() { chat.log = null; $('#chat').replaceChildren(); }

function leaveGameView() {
  S.game = null; voice.leave(true); voice.forced = false; resetChat();
  $('#hud').hidden = true; document.body.classList.remove('playing');
  scene.setMode('menu'); closeModal(); renderRoute();
}

async function endGame(m) {
  const g = S.game;
  if (g && m.gid && g.gid !== m.gid) return; // stale
  S.game = null; voice.leave(false); voice.forced = false; resetChat();
  $('#hud').hidden = true; document.body.classList.remove('playing');
  scene.setMode('menu');
  if (m.you < 0) {
    const names = g.players.map((p) => p.username);
    modal(el('div', { class: 'panel' }, el('h2', {}, 'Game over'), el('div', { class: 'big' }, `${m.score[0]} – ${m.score[1]}`),
      el('p', {}, el('b', {}, names[m.winner]), ' wins', m.forfeit ? ' (forfeit)' : '', '.'),
      el('button', { onclick: () => { closeModal(); location.hash = m.comp ? `#/competition/${m.comp.id}` : '#/'; renderRoute(); } }, m.comp ? 'Back to bracket' : 'Back to lobby')));
    renderRoute(); return;
  }
  const won = m.winner === m.you;
  try { S.user = (await api('/auth/me')).user; } catch { /* keep stale */ }
  const again = m.kind === 'ai' ? () => { closeModal(); send({ t: 'ai', level: g?.players[1]?.username.match(/\((\w+)\)/)?.[1] || S.level }); }
    : m.kind === 'ranked' ? () => { send({ t: 'queue' }); } : null;
  modal(el('div', { class: 'panel' },
    el('div', { class: `big ${won ? 'win' : 'lose'}` }, won ? 'VICTORY' : 'DEFEAT'),
    el('h2', {}, `${m.score[m.you]} – ${m.score[1 - m.you]}`),
    m.forfeit && el('p', { class: 'dim' }, won ? 'Your opponent left the game.' : 'Game forfeited.'),
    m.kind !== 'ai' ? el('p', {}, 'Rating ', el('b', {}, m.rating), ' ', m.delta ? el('span', { class: `delta ${m.delta > 0 ? 'up' : 'down'}` }, `(${m.delta > 0 ? '+' : ''}${m.delta})`) : '') : null,
    m.kind === 'competition' && el('p', { class: 'dim' }, won ? 'You advance to the next round!' : 'You’ve been knocked out of the bracket.'),
    el('div', { class: 'row', style: 'justify-content:center;margin-top:14px' },
      again && el('button', { onclick: again }, m.kind === 'ranked' ? 'Find another match' : 'Play again'),
      el('button', { class: 'ghost', onclick: () => { closeModal(); location.hash = m.comp ? `#/competition/${m.comp.id}` : '#/'; renderRoute(); } }, m.comp ? 'Back to bracket' : 'Menu'))));
  renderRoute();
}

// ---------- chat ----------
const chat = { open: false, unread: 0, log: null, input: null, toggle: null, mute: null, host: false, muted: false };
function buildChat(m) {
  chat.host = !!m.host; chat.muted = !!m.muted; chat.open = false; chat.unread = 0;
  chat.log = el('div', { class: 'log' });
  chat.input = el('input', { maxlength: 200, placeholder: 'Say something…', autocomplete: 'off', enterkeyhint: 'send' });
  chat.input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { chat.input.blur(); openChat(false); } });
  const form = el('form', { onsubmit: (e) => { e.preventDefault(); const text = chat.input.value.trim(); if (text) send({ t: 'chat', text }); chat.input.value = ''; } }, chat.input, el('button', { type: 'submit', class: 'alt' }, 'Send'));
  chat.form = form; chat.toggle = el('button', { class: 'ghost', onclick: () => openChat(!chat.open) });
  chat.mute = m.hasHost && chat.host ? el('button', { class: 'ghost', onclick: () => send({ t: 'mute_all', on: !chat.muted }) }) : null;
  const root = $('#chat');
  root.className = ''; root.replaceChildren(chat.log, form, el('div', { class: 'bar' }, chat.toggle, chat.mute));
  form.hidden = true;
  (m.chat || []).forEach((c) => addChat(c, true));
  refreshChat();
}
function refreshChat() {
  if (!chat.toggle) return;
  chat.toggle.replaceChildren('💬 Chat', chat.unread ? el('span', { class: 'badge' }, chat.unread) : '');
  if (chat.mute) { chat.mute.textContent = chat.muted ? '🔊 Unmute all' : '🔇 Mute all'; chat.mute.classList.toggle('danger', chat.muted); }
  const blocked = chat.muted && !chat.host;
  chat.input.disabled = blocked; chat.input.placeholder = blocked ? 'Chat muted by the host' : 'Say something…';
}
function openChat(on) {
  chat.open = on; $('#chat').classList.toggle('open', on); chat.form.hidden = !on;
  if (on) { chat.unread = 0; chat.log.scrollTop = chat.log.scrollHeight; if (!chat.input.disabled) chat.input.focus(); }
  refreshChat();
}
function addChat(m, quiet = false) {
  if (!chat.log) return;
  const line = el('div', { class: `line ${m.sys ? 'sys' : ''} ${m.host ? 'host' : ''}` }, m.sys ? m.text : [el('b', {}, m.name + (m.host ? ' ★' : '') + ': '), m.text]);
  chat.log.append(line);
  while (chat.log.children.length > 60) chat.log.firstChild.remove();
  setTimeout(() => line.classList.add('old'), quiet ? 0 : 7000);
  chat.log.scrollTop = chat.log.scrollHeight;
  if (!quiet && !chat.open && !m.sys && m.uid !== S.user.id) { chat.unread++; refreshChat(); }
}
function onMuted(m) {
  chat.muted = m.on; chat.host = m.host || chat.host;
  if (!m.host) voice.setForced(m.on);
  addChat({ sys: true, text: m.on ? `${m.by} muted everyone` : `${m.by} unmuted everyone` });
  refreshChat();
}

// ---------- voice panel ----------
function renderVoice() {
  const box = $('#voice');
  if (!box) return;
  if (!S.game) { box.replaceChildren(); return; }
  if (!voice.active) {
    box.replaceChildren(el('button', { class: 'ghost', style: 'background:var(--panel)', disabled: voice.joining, onclick: () => voice.join() }, voice.joining ? 'Connecting…' : '🎙 Join voice chat'));
    return;
  }
  const others = voice.members();
  box.replaceChildren(el('div', { class: 'vbox' },
    el('div', {}, el('b', {}, '● Voice'), ' · ', others.length ? others.join(', ') : 'just you so far'),
    el('div', { class: 'row' },
      !voice.hasMic ? el('span', { class: 'dim' }, 'listen-only') : voice.forced ? el('button', { class: 'danger', disabled: true }, '🔇 Muted by host') : el('button', { class: voice.muted ? 'danger' : 'alt', onclick: () => voice.setMuted(!voice.muted) }, voice.muted ? '🔇 Unmute' : '🎙 Mute'),
      el('button', { class: 'ghost', onclick: () => voice.leave(true) }, 'Leave'))));
}

// ---------- boot ----------
(async function boot() {
  if (S.token) {
    try { S.user = (await api('/auth/me')).user; connect(); } catch { S.token = null; store.set('token', null); }
  }
  renderRoute();
})();
