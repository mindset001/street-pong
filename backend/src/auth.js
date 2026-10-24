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
export const publicUser = (u) => ({ id: u._id, username: u.username, rating: u.rating, wins: u.wins, losses: u.losses, titles: u.titles });
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
  const doc = { _id: await nextId('users'), username, usernameLower: username.toLowerCase(), passHash: hash, rating: 1000, wins: 0, losses: 0, titles: 0, createdAt: now() };
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

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));
