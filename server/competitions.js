import { Router } from 'express';
import { q, tx, now } from './db.js';
import { randomInt } from 'node:crypto';
import { requireAuth } from './auth.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alikes (0/O, 1/I)
function newCode() {
  for (;;) {
    const c = Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
    if (!q.get('SELECT 1 FROM competitions WHERE invite_code = ?', c)) return c;
  }
}
for (const r of q.all('SELECT id FROM competitions WHERE invite_code IS NULL')) q.run('UPDATE competitions SET invite_code = ? WHERE id = ?', newCode(), r.id);

export const router = Router();
const hooks = { changed: () => {}, matchReady: () => {}, readyUsers: () => [] };
export const setHooks = (h) => Object.assign(hooks, h);

export const SIZES = [4, 8, 16];
export const READY_TIMEOUT = 3 * 60_000;

const getComp = (id) => q.get('SELECT c.*, u.username AS creator FROM competitions c JOIN users u ON u.id = c.creator_id WHERE c.id = ?', id);
const players = (id) => q.all('SELECT u.id, u.username, u.rating FROM competition_players cp JOIN users u ON u.id = cp.user_id WHERE cp.competition_id = ? ORDER BY cp.joined_at', id);

export function details(id, meId) {
  const c = getComp(id);
  if (!c) return null;
  const ps = players(id);
  const rows = q.all(`SELECT m.*, a.username AS n1, b.username AS n2, w.username AS nw
    FROM competition_matches m LEFT JOIN users a ON a.id = m.p1 LEFT JOIN users b ON b.id = m.p2 LEFT JOIN users w ON w.id = m.winner
    WHERE m.competition_id = ? ORDER BY m.round, m.slot`, id);
  const rounds = [];
  for (const m of rows) {
    (rounds[m.round - 1] ??= []).push({
      id: m.id, slot: m.slot, status: m.status, p1: m.p1 && { id: m.p1, username: m.n1 }, p2: m.p2 && { id: m.p2, username: m.n2 },
      winner: m.winner, s1: m.s1, s2: m.s2, bye: m.status === 'done' && m.s1 === null,
      ready: m.status === 'ready' ? hooks.readyUsers(m.id) : [],
      readyDeadline: m.status === 'ready' ? m.ready_at + READY_TIMEOUT : null,
    });
  }
  const champion = c.champion_id ? ps.find((p) => p.id === c.champion_id) || q.get('SELECT id, username FROM users WHERE id = ?', c.champion_id) : null;
  return {
    id: c.id, code: c.invite_code, name: c.name, size: c.size, status: c.status, creatorId: c.creator_id, creator: c.creator,
    champion, players: ps, rounds, joined: !!meId && ps.some((p) => p.id === meId),
  };
}

function buildBracket(compId) {
  const ps = players(compId).map((p) => p.id);
  for (let i = ps.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ps[i], ps[j]] = [ps[j], ps[i]]; }
  let B = 2; while (B < ps.length) B *= 2;
  const pos = new Array(B).fill(null);
  const order = [];
  for (let i = 0; i < B; i += 2) order.push(i);
  for (let i = 1; i < B; i += 2) order.push(i);
  ps.forEach((p, i) => { pos[order[i]] = p; });
  const rounds = Math.log2(B);
  const ins = (r, s, a, b) => q.run('INSERT INTO competition_matches (competition_id, round, slot, p1, p2) VALUES (?,?,?,?,?)', compId, r, s, a, b);
  for (let r = 1; r <= rounds; r++) for (let s = 0; s < B / 2 ** r; s++) r === 1 ? ins(r, s, pos[2 * s], pos[2 * s + 1]) : ins(r, s, null, null);
  q.run("UPDATE competitions SET status = 'running' WHERE id = ?", compId);
  // Resolve byes, then flag ready matches.
  for (const m of q.all('SELECT * FROM competition_matches WHERE competition_id = ? AND round = 1', compId)) {
    if (!m.p1 || !m.p2) finishMatch(m, m.p1 || m.p2, null, null);
  }
  for (const m of q.all("SELECT * FROM competition_matches WHERE competition_id = ? AND status = 'waiting' AND p1 IS NOT NULL AND p2 IS NOT NULL", compId)) markReady(m);
}

function markReady(m) {
  q.run("UPDATE competition_matches SET status = 'ready', ready_at = ? WHERE id = ?", now(), m.id);
  hooks.matchReady(q.get('SELECT * FROM competition_matches WHERE id = ?', m.id));
}

/** Set a winner and push them into the next round (or crown the champion). */
function finishMatch(m, winner, s1, s2) {
  q.run("UPDATE competition_matches SET status = 'done', winner = ?, s1 = ?, s2 = ? WHERE id = ?", winner, s1, s2, m.id);
  const next = q.get('SELECT * FROM competition_matches WHERE competition_id = ? AND round = ? AND slot = ?', m.competition_id, m.round + 1, m.slot >> 1);
  if (!next) {
    q.run("UPDATE competitions SET status = 'finished', champion_id = ? WHERE id = ?", winner, m.competition_id);
    q.run('UPDATE users SET titles = titles + 1 WHERE id = ?', winner);
    return;
  }
  q.run(`UPDATE competition_matches SET ${m.slot % 2 === 0 ? 'p1' : 'p2'} = ? WHERE id = ?`, winner, next.id);
  const n = q.get('SELECT * FROM competition_matches WHERE id = ?', next.id);
  if (n.p1 && n.p2) markReady(n);
}

/** Called by the lobby when a bracket game ends. Scores are in (p1, p2) order. */
export function reportResult(matchId, winner, s1, s2) {
  const m = q.get('SELECT * FROM competition_matches WHERE id = ?', matchId);
  if (!m || m.status === 'done') return;
  tx(() => finishMatch(m, winner, s1, s2));
  hooks.changed(m.competition_id);
}

export function setPlaying(matchId) {
  q.run("UPDATE competition_matches SET status = 'playing' WHERE id = ? AND status = 'ready'", matchId);
  hooks.changed(q.get('SELECT competition_id FROM competition_matches WHERE id = ?', matchId)?.competition_id);
}

/** Server restart: games in flight are gone, give players a fresh window to replay. */
export function recoverPlaying() {
  q.run("UPDATE competition_matches SET status = 'ready', ready_at = ? WHERE status = 'playing'", now());
}

/** Walkovers for matches nobody (or only one player) showed up for. */
export function sweepWalkovers() {
  for (const m of q.all("SELECT * FROM competition_matches WHERE status = 'ready' AND ready_at < ?", now() - READY_TIMEOUT)) {
    const ready = hooks.readyUsers(m.id);
    let w = ready.includes(m.p1) ? m.p1 : ready.includes(m.p2) ? m.p2 : null;
    if (!w) {
      const [a, b] = [m.p1, m.p2].map((id) => q.get('SELECT rating FROM users WHERE id = ?', id).rating);
      w = a >= b ? m.p1 : m.p2;
    }
    reportResult(m.id, w, w === m.p1 ? 11 : 0, w === m.p2 ? 11 : 0);
  }
}

// ---- HTTP ----
router.get('/', (req, res) => {
  const rows = q.all(`SELECT c.id, c.name, c.size, c.status, c.created_at, u.username AS creator, ch.username AS champion,
      (SELECT COUNT(*) FROM competition_players WHERE competition_id = c.id) AS players
    FROM competitions c JOIN users u ON u.id = c.creator_id LEFT JOIN users ch ON ch.id = c.champion_id
    ORDER BY CASE c.status WHEN 'open' THEN 0 WHEN 'running' THEN 1 ELSE 2 END, c.created_at DESC LIMIT 60`);
  res.json({ competitions: rows });
});

// Resolve an invite code (from a shared link or typed in) to a competition id.
router.get('/code/:code', requireAuth, (req, res) => {
  const c = q.get('SELECT id FROM competitions WHERE invite_code = ?', String(req.params.code).toUpperCase().trim());
  c ? res.json({ id: c.id }) : res.status(404).json({ error: 'No competition matches that code' });
});

router.get('/:id', requireAuth, (req, res) => {
  const d = details(Number(req.params.id), req.user.id);
  d ? res.json(d) : res.status(404).json({ error: 'Competition not found' });
});

router.post('/', requireAuth, (req, res) => {
  const name = String(req.body?.name ?? '').trim().replace(/\s+/g, ' ');
  const size = Number(req.body?.size);
  if (name.length < 3 || name.length > 40) return res.status(400).json({ error: 'Name must be 3-40 characters' });
  if (!SIZES.includes(size)) return res.status(400).json({ error: `Size must be one of ${SIZES.join(', ')}` });
  const open = q.get("SELECT COUNT(*) AS n FROM competitions WHERE creator_id = ? AND status != 'finished'", req.user.id).n;
  if (open >= 3) return res.status(400).json({ error: 'You already have 3 active competitions' });
  const id = tx(() => {
    const r = q.run('INSERT INTO competitions (name, creator_id, size, created_at, invite_code) VALUES (?,?,?,?,?)', name, req.user.id, size, now(), newCode());
    q.run('INSERT INTO competition_players VALUES (?,?,?)', r.lastInsertRowid, req.user.id, now());
    return Number(r.lastInsertRowid);
  });
  hooks.changed(id);
  res.json(details(id, req.user.id));
});

router.post('/:id/join', requireAuth, (req, res) => {
  const id = Number(req.params.id), c = getComp(id);
  if (!c) return res.status(404).json({ error: 'Competition not found' });
  if (c.status !== 'open') return res.status(400).json({ error: 'Registration is closed' });
  const count = q.get('SELECT COUNT(*) AS n FROM competition_players WHERE competition_id = ?', id).n;
  if (count >= c.size) return res.status(400).json({ error: 'Competition is full' });
  if (q.get('SELECT 1 FROM competition_players WHERE competition_id = ? AND user_id = ?', id, req.user.id)) return res.status(400).json({ error: 'Already joined' });
  tx(() => {
    q.run('INSERT INTO competition_players VALUES (?,?,?)', id, req.user.id, now());
    if (count + 1 === c.size) buildBracket(id); // full -> start automatically
  });
  hooks.changed(id);
  res.json(details(id, req.user.id));
});

router.post('/:id/leave', requireAuth, (req, res) => {
  const id = Number(req.params.id), c = getComp(id);
  if (!c) return res.status(404).json({ error: 'Competition not found' });
  if (c.status !== 'open') return res.status(400).json({ error: 'Competition already started' });
  if (c.creator_id === req.user.id) return res.status(400).json({ error: 'Creators can cancel instead of leaving' });
  q.run('DELETE FROM competition_players WHERE competition_id = ? AND user_id = ?', id, req.user.id);
  hooks.changed(id);
  res.json(details(id, req.user.id));
});

router.post('/:id/start', requireAuth, (req, res) => {
  const id = Number(req.params.id), c = getComp(id);
  if (!c) return res.status(404).json({ error: 'Competition not found' });
  if (c.creator_id !== req.user.id) return res.status(403).json({ error: 'Only the creator can start it' });
  if (c.status !== 'open') return res.status(400).json({ error: 'Already started' });
  if (players(id).length < 2) return res.status(400).json({ error: 'Need at least 2 players' });
  tx(() => buildBracket(id));
  hooks.changed(id);
  res.json(details(id, req.user.id));
});

router.delete('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id), c = getComp(id);
  if (!c) return res.status(404).json({ error: 'Competition not found' });
  if (c.creator_id !== req.user.id) return res.status(403).json({ error: 'Only the creator can cancel it' });
  if (c.status !== 'open') return res.status(400).json({ error: 'Already started' });
  q.run('DELETE FROM competitions WHERE id = ?', id);
  hooks.changed(id);
  res.json({ ok: true });
});
