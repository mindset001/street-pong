import { WebSocketServer } from 'ws';
import { Game, C } from './physics.js';
import { AI, LEVELS } from './ai.js';
import { verify } from './auth.js';
import { q } from './db.js';
import { recordMatch } from './ratings.js';
import * as comps from './competitions.js';

const TARGET = 11;
const RECONNECT_MS = 15_000;

const clients = new Map();   // userId -> { ws, user }
const sessions = new Map();  // gameId -> session
const inGame = new Map();    // userId -> session
const queue = [];            // userIds waiting for a ranked game
const ready = new Map();     // compMatchId -> Set<userId>
let nextId = 1;

const send = (ws, msg) => { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); };
const sendUser = (uid, msg) => send(clients.get(uid)?.ws, msg);
const broadcast = (msg) => { const s = JSON.stringify(msg); for (const c of clients.values()) if (c.ws.readyState === 1) c.ws.send(s); };
const userRow = (id) => q.get('SELECT id, username, rating FROM users WHERE id = ?', id);

comps.setHooks({
  changed: (id) => broadcast({ t: 'comp', id }),
  readyUsers: (mid) => [...(ready.get(mid) || [])],
  matchReady: (m) => {
    const c = q.get('SELECT name FROM competitions WHERE id = ?', m.competition_id);
    for (const uid of [m.p1, m.p2]) sendUser(uid, { t: 'comp_match', compId: m.competition_id, matchId: m.id, name: c?.name });
    broadcast({ t: 'comp', id: m.competition_id });
  },
});

function startSession({ kind, humans, ai, compMatch }) {
  // humans: [userId|null, userId|null]; null seat = AI
  const game = new Game({ target: TARGET });
  const s = {
    id: nextId++, kind, game, humans, compMatch,
    ai: humans.map((h, i) => (h ? null : new AI(game, i, ai))),
    aiLevel: ai, away: [null, null], acc: 0, last: performance.now(),
  };
  s.users = humans.map((h) => (h ? userRow(h) : null));
  sessions.set(s.id, s);
  humans.forEach((h) => { if (h) { inGame.set(h, s); const i = queue.indexOf(h); if (i >= 0) queue.splice(i, 1); } });
  humans.forEach((h, i) => h && sendStart(s, i));
  return s;
}

function sendStart(s, idx, resume = false) {
  const players = s.users.map((u, i) => (u ? { username: u.username, rating: u.rating } : { username: `CPU (${s.aiLevel})`, rating: null }));
  sendUser(s.humans[idx], {
    t: 'start', gid: s.id, you: idx, kind: s.kind, target: TARGET, players, resume, score: s.game.score,
    comp: s.compMatch ? { id: s.compMatch.compId, matchId: s.compMatch.id } : null,
  });
}

function finish(s, winnerIdx, forfeit = false) {
  if (!sessions.delete(s.id)) return;
  const [a, b] = s.game.score;
  const [u1, u2] = s.users;
  const res = { d1: 0, d2: 0 };
  let recorded = null;
  const wId = winnerIdx === null ? null : s.users[winnerIdx]?.id ?? null;
  if (s.kind === 'ai') {
    // Only completed games vs the CPU are logged (no rating change).
    if (!forfeit && u1) recorded = recordMatch({ p1: u1.id, p2: null, s1: a, s2: b, winner: winnerIdx === 0 ? u1.id : null, kind: 'ai' });
  } else {
    recorded = recordMatch({ p1: u1.id, p2: u2.id, s1: a, s2: b, winner: wId, kind: s.kind });
    Object.assign(res, { d1: recorded.d1, d2: recorded.d2 });
    if (s.compMatch) { ready.delete(s.compMatch.id); comps.reportResult(s.compMatch.id, wId, a, b); }
  }
  s.humans.forEach((h, i) => {
    if (!h) return;
    inGame.delete(h);
    const fresh = userRow(h);
    sendUser(h, {
      t: 'over', gid: s.id, kind: s.kind, winner: winnerIdx, you: i, score: [a, b], forfeit,
      rating: fresh.rating, delta: i === 0 ? res.d1 : res.d2, comp: s.compMatch ? { id: s.compMatch.compId } : null,
    });
  });
  broadcastLobby();
}

function tryMatchmake() {
  while (queue.length >= 2) {
    const [a, b] = queue.splice(0, 2);
    const players = Math.random() < 0.5 ? [a, b] : [b, a];
    startSession({ kind: 'ranked', humans: players });
  }
  broadcastLobby();
}

function broadcastLobby() {
  broadcast({ t: 'lobby', online: clients.size, playing: sessions.size, queued: queue.length });
}

function handle(ws, state, msg) {
  const uid = state.user.id;
  const s = inGame.get(uid);
  switch (msg.t) {
    case 'p': { // paddle target in player-local coords
      if (s) s.game.setPaddleTarget(s.humans.indexOf(uid), msg.x, msg.y);
      break;
    }
    case 'serve': {
      if (s && s.game.server === s.humans.indexOf(uid)) s.game.serve();
      break;
    }
    case 'queue': {
      if (s) return send(ws, { t: 'err', msg: 'Finish your current game first' });
      if (!queue.includes(uid)) queue.push(uid);
      send(ws, { t: 'queued' });
      tryMatchmake();
      break;
    }
    case 'unqueue': {
      const i = queue.indexOf(uid); if (i >= 0) queue.splice(i, 1);
      send(ws, { t: 'unqueued' }); broadcastLobby();
      break;
    }
    case 'ai': {
      if (s) return send(ws, { t: 'err', msg: 'Finish your current game first' });
      const level = LEVELS[msg.level] ? msg.level : 'medium';
      const i = queue.indexOf(uid); if (i >= 0) queue.splice(i, 1);
      startSession({ kind: 'ai', humans: [uid, null], ai: level });
      broadcastLobby();
      break;
    }
    case 'leave': {
      if (s) finish(s, 1 - s.humans.indexOf(uid), true);
      break;
    }
    case 'comp_ready': {
      if (s) return send(ws, { t: 'err', msg: 'Finish your current game first' });
      const m = q.get("SELECT * FROM competition_matches WHERE id = ? AND status = 'ready'", Number(msg.matchId));
      if (!m || (m.p1 !== uid && m.p2 !== uid)) return send(ws, { t: 'err', msg: 'That match is not available' });
      const set = ready.get(m.id) || ready.set(m.id, new Set()).get(m.id);
      set.add(uid);
      if (set.has(m.p1) && set.has(m.p2) && clients.has(m.p1) && clients.has(m.p2) && !inGame.has(m.p1) && !inGame.has(m.p2)) {
        comps.setPlaying(m.id);
        startSession({ kind: 'competition', humans: [m.p1, m.p2], compMatch: { id: m.id, compId: m.competition_id } });
        broadcastLobby();
      } else broadcast({ t: 'comp', id: m.competition_id });
      break;
    }
    case 'comp_unready': {
      const set = ready.get(Number(msg.matchId));
      if (set && !inGame.has(uid)) { set.delete(uid); const m = q.get('SELECT competition_id FROM competition_matches WHERE id = ?', Number(msg.matchId)); if (m) broadcast({ t: 'comp', id: m.competition_id }); }
      break;
    }
  }
}

export function attach(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 });
  wss.on('connection', (ws) => {
    let state = null;
    const timer = setTimeout(() => !state && ws.close(4001, 'auth timeout'), 5000);
    ws.on('message', (data) => {
      let msg; try { msg = JSON.parse(data); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;
      if (!state) {
        if (msg.t !== 'auth') return;
        const user = verify(String(msg.token));
        if (!user) { send(ws, { t: 'authfail' }); return ws.close(4002, 'bad token'); }
        clearTimeout(timer);
        state = { user };
        const prev = clients.get(user.id);
        clients.set(user.id, { ws, user });
        if (prev && prev.ws !== ws) { send(prev.ws, { t: 'err', msg: 'Signed in from another tab' }); prev.ws.close(4003, 'replaced'); }
        send(ws, { t: 'hello', user, ...{ online: clients.size, playing: sessions.size, queued: queue.length } });
        const s = inGame.get(user.id);
        if (s) { const i = s.humans.indexOf(user.id); s.away[i] = null; sendStart(s, i, true); }
        broadcastLobby();
        return;
      }
      handle(ws, state, msg);
    });
    ws.on('close', () => {
      clearTimeout(timer);
      if (!state) return;
      const uid = state.user.id;
      if (clients.get(uid)?.ws !== ws) return; // superseded by a newer connection
      clients.delete(uid);
      const qi = queue.indexOf(uid); if (qi >= 0) queue.splice(qi, 1);
      for (const set of ready.values()) set.delete(uid);
      const s = inGame.get(uid);
      if (s) s.away[s.humans.indexOf(uid)] = Date.now() + RECONNECT_MS;
      broadcastLobby();
    });
    ws.on('error', () => {});
  });

  // Game loop: 60 Hz network tick, two 120 Hz physics sub-steps.
  setInterval(() => {
    const t = Date.now();
    for (const s of [...sessions.values()]) {
      const gone = s.away.findIndex((d) => d && t > d);
      if (gone >= 0) { finish(s, 1 - gone, true); continue; }
      if (s.away.some(Boolean)) continue; // paused while someone reconnects
      for (let i = 0; i < 2; i++) {
        s.ai.forEach((a) => a?.update(C.DT));
        s.game.step();
      }
      const snap = s.game.snapshot();
      const m = JSON.stringify(snap);
      s.humans.forEach((h) => h && clients.get(h)?.ws.readyState === 1 && clients.get(h).ws.send(m));
      if (s.game.over) finish(s, s.game.winner);
    }
  }, 1000 / 60);

  setInterval(() => comps.sweepWalkovers(), 10_000);
  comps.recoverPlaying();
  return wss;
}

export const stats = () => ({ online: clients.size, playing: sessions.size, queued: queue.length });
