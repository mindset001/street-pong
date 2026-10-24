import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { Router } from 'express';
import { q, now } from './db.js';

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const f = new URL('../data/jwt.secret', import.meta.url).pathname;
  if (!existsSync(f)) { mkdirSync(new URL('../data', import.meta.url).pathname, { recursive: true }); writeFileSync(f, randomBytes(48).toString('hex'), { mode: 0o600 }); }
  return readFileSync(f, 'utf8');
}
const SECRET = loadSecret();

export const sign = (u) => jwt.sign({ uid: u.id }, SECRET, { expiresIn: '14d' });
export function verify(token) {
  try { return q.get('SELECT id, username, rating FROM users WHERE id = ?', jwt.verify(token, SECRET).uid) || null; } catch { return null; }
}
export const publicUser = (u) => ({ id: u.id, username: u.username, rating: u.rating, wins: u.wins, losses: u.losses, titles: u.titles });

// Tiny in-memory limiter: 20 auth attempts / 10 min per IP.
const hits = new Map();
function limiter(req, res, next) {
  const k = req.ip, t = now();
  const arr = (hits.get(k) || []).filter((x) => t - x < 600_000);
  if (arr.length >= 20) return res.status(429).json({ error: 'Too many attempts, try again later' });
  arr.push(t); hits.set(k, arr); next();
}

export function requireAuth(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const u = m && verify(m[1]);
  if (!u) return res.status(401).json({ error: 'Please log in' });
  req.user = u; next();
}

export const router = Router();
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

router.post('/register', limiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || !NAME_RE.test(username)) return res.status(400).json({ error: 'Username must be 3-16 letters, numbers or _' });
  if (typeof password !== 'string' || password.length < 6 || password.length > 72) return res.status(400).json({ error: 'Password must be 6-72 characters' });
  if (q.get('SELECT 1 FROM users WHERE username = ?', username)) return res.status(409).json({ error: 'Username already taken' });
  const hash = await bcrypt.hash(password, 10);
  try {
    const r = q.run('INSERT INTO users (username, pass_hash, created_at) VALUES (?,?,?)', username, hash, now());
    const u = q.get('SELECT * FROM users WHERE id = ?', r.lastInsertRowid);
    res.json({ token: sign(u), user: publicUser(u) });
  } catch { res.status(409).json({ error: 'Username already taken' }); }
});

router.post('/login', limiter, async (req, res) => {
  const { username, password } = req.body || {};
  const u = typeof username === 'string' ? q.get('SELECT * FROM users WHERE username = ?', username) : null;
  // Always run a compare so response time doesn't reveal whether the user exists.
  const ok = await bcrypt.compare(String(password ?? ''), u?.pass_hash || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
  if (!u || !ok) return res.status(401).json({ error: 'Invalid username or password' });
  res.json({ token: sign(u), user: publicUser(u) });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(q.get('SELECT * FROM users WHERE id = ?', req.user.id)) }));
