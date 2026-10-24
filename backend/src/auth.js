import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { Router } from 'express';
import { users, nextId, now, isDup } from './db.js';

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  // Dev convenience: persist a generated secret. Hosts with read-only/ephemeral disks can't, so fall back to a
  // per-process secret (everyone is logged out on each restart) and say so loudly. Set JWT_SECRET in production.
  try {
    const dir = new URL('../data', import.meta.url).pathname, f = `${dir}/jwt.secret`;
    if (!existsSync(f)) { mkdirSync(dir, { recursive: true }); writeFileSync(f, randomBytes(48).toString('hex'), { mode: 0o600 }); }
    return readFileSync(f, 'utf8');
  } catch {
    console.warn('WARNING: JWT_SECRET is not set and data/ is not writable; using a temporary secret. Set JWT_SECRET so logins survive restarts.');
    return randomBytes(48).toString('hex');
  }
}
const SECRET = loadSecret();

/** Shape sent to clients: numeric `id`, never the hash. */
// Player customisation: only values from these lists are accepted (they end up in other people's pages).
export const AVATARS = ['🏓', '😎', '🦊', '🐼', '🐯', '🦁', '🐸', '🐙', '🦄', '🐲', '🚀', '⚡', '🔥', '👑', '🥷', '🤠'];
export const COLORS = ['#ffa51f', '#38d6ff', '#3ddc97', '#ff5d73', '#a78bfa', '#f472b6', '#facc15', '#94a3b8', '#fb923c', '#22d3ee'];
export const PADDLES = ['#d7263d', '#22262e', '#2563eb', '#16a34a', '#9333ea', '#f59e0b', '#ec4899', '#e5e7eb'];
export const CHAR_OPTIONS = {
  skin: ['#f8d5b8', '#f1c27d', '#e0a370', '#c68642', '#8d5524', '#5c3a1e'],
  hairStyle: ['short', 'buzz', 'long', 'ponytail', 'afro', 'bald'],
  hair: ['#1a1410', '#4a2f1b', '#8b5a2b', '#d4a017', '#c0392b', '#e5e7eb', '#2563eb', '#a855f7'],
  shirt: ['#ffa51f', '#38d6ff', '#3ddc97', '#ff5d73', '#a78bfa', '#f472b6', '#facc15', '#e5e7eb', '#2563eb', '#111827'],
  shorts: ['#111827', '#1e3a8a', '#14532d', '#7f1d1d', '#e5e7eb', '#78350f'],
  accessory: ['none', 'headband', 'cap', 'shades'],
};
const pick = (list, i) => list[Math.abs(i) % list.length];
const defaultChar = (id) => Object.fromEntries(Object.entries(CHAR_OPTIONS).map(([k, list], n) => [k, pick(list, id * (n + 2) + n)]));
/** Returns a clean character object, or null if any value isn't from the allowed lists. */
export function cleanChar(c) {
  if (!c || typeof c !== 'object') return null;
  const out = {};
  for (const [k, list] of Object.entries(CHAR_OPTIONS)) { if (!list.includes(c[k])) return null; out[k] = c[k]; }
  return out;
}

export const playerLook = (u) => ({
  avatar: u.avatar || pick(AVATARS, u._id), color: u.color || pick(COLORS, u._id), paddle: u.paddle || pick(PADDLES, u._id),
  char: cleanChar(u.char) || defaultChar(u._id),
});
export const publicUser = (u) => ({ id: u._id, username: u.username, rating: u.rating, wins: u.wins, losses: u.losses, titles: u.titles, ...playerLook(u) });
export const sign = (u) => jwt.sign({ uid: u._id }, SECRET, { expiresIn: '14d' });
export async function verify(token) {
  try {
    const u = await users.findOne({ _id: jwt.verify(token, SECRET).uid });
    return u ? publicUser(u) : null;
  } catch { return null; }
}

// Tiny in-memory limiter: 20 auth attempts / 10 min per IP.
const hits = new Map();
function limiter(req, res, next) {
  const k = req.ip, t = now();
  const arr = (hits.get(k) || []).filter((x) => t - x < 600_000);
  if (arr.length >= 20) return res.status(429).json({ error: 'Too many attempts, try again later' });
  arr.push(t); hits.set(k, arr); next();
}

export async function requireAuth(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const u = m && await verify(m[1]);
  if (!u) return res.status(401).json({ error: 'Please log in' });
  req.user = u; next();
}

export const router = Router();
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

router.post('/register', limiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || !NAME_RE.test(username)) return res.status(400).json({ error: 'Username must be 3-16 letters, numbers or _' });
  if (typeof password !== 'string' || password.length < 6 || password.length > 72) return res.status(400).json({ error: 'Password must be 6-72 characters' });
  const hash = await bcrypt.hash(password, 10);
  const id = await nextId('users');
  const doc = { _id: id, username, avatar: pick(AVATARS, id), color: pick(COLORS, id * 3), paddle: pick(PADDLES, id * 5), char: defaultChar(id), usernameLower: username.toLowerCase(), passHash: hash, rating: 1000, wins: 0, losses: 0, titles: 0, createdAt: now() };
  try {
    await users.insertOne(doc);
    res.json({ token: sign(doc), user: publicUser(doc) });
  } catch (e) {
    if (isDup(e)) return res.status(409).json({ error: 'Username already taken' });
    throw e;
  }
});

router.post('/login', limiter, async (req, res) => {
  const { username, password } = req.body || {};
  const u = typeof username === 'string' ? await users.findOne({ usernameLower: username.toLowerCase() }) : null;
  // Always run a compare so response time doesn't reveal whether the user exists.
  const ok = await bcrypt.compare(String(password ?? ''), u?.passHash || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
  if (!u || !ok) return res.status(401).json({ error: 'Invalid username or password' });
  res.json({ token: sign(u), user: publicUser(u) });
});

router.get('/player-options', (req, res) => res.json({ avatars: AVATARS, colors: COLORS, paddles: PADDLES, char: CHAR_OPTIONS }));

router.put('/player', requireAuth, async (req, res) => {
  const { avatar, color, paddle } = req.body || {};
  if (!AVATARS.includes(avatar) || !COLORS.includes(color) || !PADDLES.includes(paddle)) return res.status(400).json({ error: 'Pick an avatar and colours from the lists' });
  const set = { avatar, color, paddle };
  if (req.body.char !== undefined) {
    const char = cleanChar(req.body.char);
    if (!char) return res.status(400).json({ error: 'Pick the character options from the lists' });
    set.char = char;
  }
  await users.updateOne({ _id: req.user.id }, { $set: set });
  res.json({ user: { ...req.user, ...set } });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));
