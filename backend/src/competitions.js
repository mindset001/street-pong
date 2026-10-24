import { Router } from 'express';
import { randomInt } from 'node:crypto';
import { users, competitions, cmatches, nextId, now, isDup } from './db.js';
import { requireAuth, playerLook } from './auth.js';

export const router = Router();
const hooks = { changed: () => {}, matchReady: () => {}, readyUsers: () => [], liveGid: () => null };
export const setHooks = (h) => Object.assign(hooks, h);

export const SIZES = [4, 8, 16];
export const READY_TIMEOUT = 3 * 60_000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alikes (0/O, 1/I)
const makeCode = () => Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next); // Express 4 doesn't catch async errors
const nameMap = async (ids) => {
  const rows = await users.find({ _id: { $in: [...new Set(ids.filter(Boolean))] } }).toArray();
  return new Map(rows.map((u) => [u._id, u]));
};

export async function details(id, meId) {
  const c = await competitions.findOne({ _id: id });
  if (!c) return null;
  const rows = await cmatches.find({ competitionId: id }).sort({ round: 1, slot: 1 }).toArray();
  const names = await nameMap([c.creatorId, c.championId, ...c.players.map((p) => p.userId), ...rows.flatMap((m) => [m.p1, m.p2])]);
  const who = (uid) => (uid ? { id: uid, username: names.get(uid)?.username ?? '?', avatar: look(uid).avatar, color: look(uid).color } : null);
  const look = (uid) => (names.get(uid) ? playerLook(names.get(uid)) : {});
  const rounds = [];
  for (const m of rows) {
    (rounds[m.round - 1] ??= []).push({
      id: m._id, slot: m.slot, status: m.status, p1: who(m.p1), p2: who(m.p2), winner: m.winner, s1: m.s1, s2: m.s2,
      bye: m.status === 'done' && m.s1 === null,
      gid: m.status === 'playing' ? hooks.liveGid(m._id) : null,
      ready: m.status === 'ready' ? hooks.readyUsers(m._id) : [],
      readyDeadline: m.status === 'ready' ? m.readyAt + READY_TIMEOUT : null,
    });
  }
  const players = c.players.map((p) => ({ id: p.userId, username: names.get(p.userId)?.username ?? '?', rating: names.get(p.userId)?.rating ?? 1000, avatar: look(p.userId).avatar, color: look(p.userId).color }));
  return {
    id: c._id, code: c.inviteCode, name: c.name, size: c.size, status: c.status, creatorId: c.creatorId, creator: names.get(c.creatorId)?.username,
    champion: c.championId ? who(c.championId) : null, players, rounds, joined: !!meId && players.some((p) => p.id === meId),
  };
}

/** Claims the open->running transition (only one caller wins), builds the bracket, resolves byes. */
async function startCompetition(filter) {
  const c = await competitions.findOneAndUpdate({ ...filter, status: 'open' }, { $set: { status: 'starting' } }, { returnDocument: 'after' });
  if (!c) return null;
  const ps = c.players.map((p) => p.userId);
  for (let i = ps.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ps[i], ps[j]] = [ps[j], ps[i]]; }
  let B = 2; while (B < ps.length) B *= 2;
  const pos = new Array(B).fill(null);
  const order = [];
  for (let i = 0; i < B; i += 2) order.push(i);
  for (let i = 1; i < B; i += 2) order.push(i);
  ps.forEach((p, i) => { pos[order[i]] = p; });
  const docs = [];
  for (let r = 1; r <= Math.log2(B); r++) {
    for (let s = 0; s < B / 2 ** r; s++) docs.push({ competitionId: c._id, round: r, slot: s, p1: r === 1 ? pos[2 * s] : null, p2: r === 1 ? pos[2 * s + 1] : null, winner: null, s1: null, s2: null, status: 'waiting', readyAt: null });
  }
  for (const d of docs) d._id = await nextId('competition_matches');
  await cmatches.insertMany(docs);
  await competitions.updateOne({ _id: c._id }, { $set: { status: 'running' } });
  for (const m of docs.filter((d) => d.round === 1 && (!d.p1 || !d.p2))) await finishMatch(m, m.p1 || m.p2, null, null);
  for (const m of await cmatches.find({ competitionId: c._id, status: 'waiting', p1: { $ne: null }, p2: { $ne: null } }).toArray()) await markReady(m);
  return c._id;
}

async function markReady(m) {
  const r = await cmatches.findOneAndUpdate({ _id: m._id, status: 'waiting' }, { $set: { status: 'ready', readyAt: now() } }, { returnDocument: 'after' });
  if (r) hooks.matchReady(r, (await competitions.findOne({ _id: r.competitionId }, { projection: { name: 1 } }))?.name);
}

/** Set a winner and push them into the next round (or crown the champion). Idempotent per match. */
async function finishMatch(m, winner, s1, s2) {
  const done = await cmatches.updateOne({ _id: m._id, status: { $ne: 'done' } }, { $set: { status: 'done', winner, s1, s2 } });
  if (!done.modifiedCount) return false;
  const next = await cmatches.findOne({ competitionId: m.competitionId, round: m.round + 1, slot: m.slot >> 1 });
  if (!next) {
    await competitions.updateOne({ _id: m.competitionId }, { $set: { status: 'finished', championId: winner } });
    await users.updateOne({ _id: winner }, { $inc: { titles: 1 } });
    return true;
  }
  const n = await cmatches.findOneAndUpdate({ _id: next._id }, { $set: { [m.slot % 2 === 0 ? 'p1' : 'p2']: winner } }, { returnDocument: 'after' });
  if (n.p1 && n.p2) await markReady(n);
  return true;
}

/** Called by the lobby when a bracket game ends. Scores are in (p1, p2) order. */
export async function reportResult(matchId, winner, s1, s2) {
  const m = await cmatches.findOne({ _id: matchId });
  if (m && await finishMatch(m, winner, s1, s2)) hooks.changed(m.competitionId);
}

export async function setPlaying(matchId) {
  const m = await cmatches.findOneAndUpdate({ _id: matchId, status: 'ready' }, { $set: { status: 'playing' } });
  if (m) hooks.changed(m.competitionId);
  return !!m;
}

/** Server restart: games in flight are gone, give players a fresh window to replay. */
export const recoverPlaying = () => cmatches.updateMany({ status: 'playing' }, { $set: { status: 'ready', readyAt: now() } });

/** Walkovers for matches nobody (or only one player) showed up for. */
export async function sweepWalkovers() {
  for (const m of await cmatches.find({ status: 'ready', readyAt: { $lt: now() - READY_TIMEOUT } }).toArray()) {
    const ready = hooks.readyUsers(m._id);
    let w = ready.includes(m.p1) ? m.p1 : ready.includes(m.p2) ? m.p2 : null;
    if (!w) {
      const [a, b] = await Promise.all([users.findOne({ _id: m.p1 }), users.findOne({ _id: m.p2 })]);
      w = a.rating >= b.rating ? m.p1 : m.p2;
    }
    await reportResult(m._id, w, w === m.p1 ? 11 : 0, w === m.p2 ? 11 : 0);
  }
}

// ---- HTTP ----
router.get('/', wrap(async (req, res) => {
  const rows = await competitions.find({}).sort({ createdAt: -1 }).limit(60).toArray();
  const names = await nameMap(rows.flatMap((c) => [c.creatorId, c.championId]));
  const rank = { open: 0, running: 1, starting: 1, finished: 2 };
  rows.sort((a, b) => rank[a.status] - rank[b.status] || b.createdAt - a.createdAt);
  res.json({ competitions: rows.map((c) => ({
    id: c._id, name: c.name, size: c.size, status: c.status === 'starting' ? 'running' : c.status, created_at: c.createdAt,
    creator: names.get(c.creatorId)?.username, champion: c.championId ? names.get(c.championId)?.username : null, players: c.players.length,
  })) });
}));

// Resolve an invite code (from a shared link or typed in) to a competition id.
router.get('/code/:code', requireAuth, wrap(async (req, res) => {
  const c = await competitions.findOne({ inviteCode: String(req.params.code).toUpperCase().trim() }, { projection: { _id: 1 } });
  c ? res.json({ id: c._id }) : res.status(404).json({ error: 'No competition matches that code' });
}));

router.get('/:id', requireAuth, wrap(async (req, res) => {
  const d = await details(Number(req.params.id), req.user.id);
  d ? res.json(d) : res.status(404).json({ error: 'Competition not found' });
}));

router.post('/', requireAuth, wrap(async (req, res) => {
  const name = String(req.body?.name ?? '').trim().replace(/\s+/g, ' ');
  const size = Number(req.body?.size);
  if (name.length < 3 || name.length > 40) return res.status(400).json({ error: 'Name must be 3-40 characters' });
  if (!SIZES.includes(size)) return res.status(400).json({ error: `Size must be one of ${SIZES.join(', ')}` });
  if (await competitions.countDocuments({ creatorId: req.user.id, status: { $ne: 'finished' } }) >= 3) return res.status(400).json({ error: 'You already have 3 active competitions' });
  const _id = await nextId('competitions');
  for (let tries = 0; ; tries++) {
    try {
      await competitions.insertOne({ _id, name, creatorId: req.user.id, size, status: 'open', championId: null, createdAt: now(), inviteCode: makeCode(), players: [{ userId: req.user.id, joinedAt: now() }] });
      break;
    } catch (e) { if (!isDup(e) || tries > 5) throw e; } // invite-code collision: roll a new one
  }
  hooks.changed(_id);
  res.json(await details(_id, req.user.id));
}));

router.post('/:id/join', requireAuth, wrap(async (req, res) => {
  const id = Number(req.params.id), c = await competitions.findOne({ _id: id });
  if (!c) return res.status(404).json({ error: 'Competition not found' });
  if (c.status !== 'open') return res.status(400).json({ error: 'Registration is closed' });
  if (c.players.some((p) => p.userId === req.user.id)) return res.status(400).json({ error: 'Already joined' });
  // Atomic: only succeeds while open, not already joined, and below capacity (concurrent joins can't overfill).
  const r = await competitions.findOneAndUpdate(
    { _id: id, status: 'open', 'players.userId': { $ne: req.user.id }, [`players.${c.size - 1}`]: { $exists: false } },
    { $push: { players: { userId: req.user.id, joinedAt: now() } } }, { returnDocument: 'after' });
  if (!r) return res.status(400).json({ error: 'Competition is full' });
  if (r.players.length === r.size) await startCompetition({ _id: id }); // full -> start automatically
  hooks.changed(id);
  res.json(await details(id, req.user.id));
}));

router.post('/:id/leave', requireAuth, wrap(async (req, res) => {
  const id = Number(req.params.id), c = await competitions.findOne({ _id: id });
  if (!c) return res.status(404).json({ error: 'Competition not found' });
  if (c.status !== 'open') return res.status(400).json({ error: 'Competition already started' });
  if (c.creatorId === req.user.id) return res.status(400).json({ error: 'Creators can cancel instead of leaving' });
  await competitions.updateOne({ _id: id, status: 'open' }, { $pull: { players: { userId: req.user.id } } });
  hooks.changed(id);
  res.json(await details(id, req.user.id));
}));

router.post('/:id/start', requireAuth, wrap(async (req, res) => {
  const id = Number(req.params.id), c = await competitions.findOne({ _id: id });
  if (!c) return res.status(404).json({ error: 'Competition not found' });
  if (c.creatorId !== req.user.id) return res.status(403).json({ error: 'Only the creator can start it' });
  if (c.status !== 'open') return res.status(400).json({ error: 'Already started' });
  if (c.players.length < 2) return res.status(400).json({ error: 'Need at least 2 players' });
  await startCompetition({ _id: id, 'players.1': { $exists: true } });
  hooks.changed(id);
  res.json(await details(id, req.user.id));
}));

router.delete('/:id', requireAuth, wrap(async (req, res) => {
  const id = Number(req.params.id), c = await competitions.findOne({ _id: id });
  if (!c) return res.status(404).json({ error: 'Competition not found' });
  if (c.creatorId !== req.user.id) return res.status(403).json({ error: 'Only the creator can cancel it' });
  if (c.status !== 'open') return res.status(400).json({ error: 'Already started' });
  await competitions.deleteOne({ _id: id, status: 'open' });
  hooks.changed(id);
  res.json({ ok: true });
}));
