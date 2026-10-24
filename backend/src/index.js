import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { users, matches, client } from './db.js';
import { router as authRouter, requireAuth, publicUser, playerLook } from './auth.js';
import { router as compRouter } from './competitions.js';
import { attach, stats, liveGames } from './lobby.js';

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY); // behind Render/Fly/nginx: real client IPs for rate limiting

// Allowed browser origins for a separately-hosted frontend (comma-separated). Unset = same-origin only.
export const ORIGINS = (process.env.CORS_ORIGIN || '').split(',').map((x) => x.trim().replace(/\/$/, '')).filter(Boolean);
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && (ORIGINS.includes('*') || ORIGINS.includes(o))) {
    res.set({ 'Access-Control-Allow-Origin': o, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Max-Age': '600' });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});
app.get('/health', (req, res) => res.json({ ok: true }));
app.use(express.json({ limit: '4kb' }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; media-src 'self' blob:; script-src 'self'",
  });
  next();
});

app.use('/api/auth', authRouter);
app.use('/api/competitions', compRouter);

app.get('/api/live', requireAuth, (req, res) => res.json({ games: liveGames() }));
app.get('/api/stats', (req, res) => res.json(stats()));

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next); // Express 4 doesn't catch async errors

app.get('/api/leaderboard', wrap(async (req, res) => {
  const sort = { rating: { rating: -1 }, wins: { wins: -1 }, titles: { titles: -1, rating: -1 } }[req.query.sort] || { rating: -1 };
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const rows = await users.find({ $or: [{ wins: { $gt: 0 } }, { losses: { $gt: 0 } }, { titles: { $gt: 0 } }] })
    .sort({ ...sort, wins: -1, _id: 1 }).limit(limit).toArray();
  res.json({ players: rows.map((r, i) => ({ rank: i + 1, ...publicUser(r), games: r.wins + r.losses })) });
}));

app.get('/api/users/:name', requireAuth, wrap(async (req, res) => {
  const u = await users.findOne({ usernameLower: String(req.params.name).toLowerCase() });
  if (!u) return res.status(404).json({ error: 'Player not found' });
  const played = u.wins + u.losses > 0;
  const rank = played ? 1 + await users.countDocuments({ rating: { $gt: u.rating }, $or: [{ wins: { $gt: 0 } }, { losses: { $gt: 0 } }] }) : null;
  const rows = await matches.find({ $or: [{ p1: u._id }, { p2: u._id }] }).sort({ _id: -1 }).limit(15).toArray();
  const names = new Map((await users.find({ _id: { $in: rows.flatMap((m) => [m.p1, m.p2]).filter(Boolean) } }).toArray()).map((x) => [x._id, x.username]));
  const recent = rows.map((m) => {
    const mine = m.p1 === u._id;
    return {
      id: m._id, kind: m.kind, at: m.createdAt, opponent: (mine ? names.get(m.p2) : names.get(m.p1)) ?? m.cpu ?? 'CPU',
      score: mine ? [m.s1, m.s2] : [m.s2, m.s1], won: m.winner === u._id, delta: mine ? m.delta1 : m.delta2,
    };
  });
  res.json({ user: publicUser(u), rank, recent });
}));

// Local convenience: if the frontend has been built (frontend/dist), serve it too. A deployed backend-only
// service simply won't have it.
const frontendDir = fileURLToPath(new URL('../../frontend/dist', import.meta.url));
if (existsSync(frontendDir)) app.use(express.static(frontendDir));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Server error' }); });

const server = createServer(app);
attach(server, ORIGINS);
const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`Street Pong running on http://localhost:${port}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { server.close(); await client.close(); process.exit(0); });
