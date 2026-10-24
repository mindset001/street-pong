import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { q } from './db.js';
import { router as authRouter, requireAuth, publicUser } from './auth.js';
import { router as compRouter } from './competitions.js';
import { attach, stats, liveGames } from './lobby.js';

const app = express();
app.disable('x-powered-by');
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

app.get('/api/leaderboard', (req, res) => {
  const sort = { rating: 'rating DESC', wins: 'wins DESC', titles: 'titles DESC, rating DESC' }[req.query.sort] || 'rating DESC';
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const rows = q.all(`SELECT id, username, rating, wins, losses, titles FROM users WHERE wins + losses > 0 OR titles > 0 ORDER BY ${sort}, wins DESC, id LIMIT ?`, limit);
  res.json({ players: rows.map((r, i) => ({ rank: i + 1, ...r, games: r.wins + r.losses })) });
});

app.get('/api/users/:name', requireAuth, (req, res) => {
  const u = q.get('SELECT * FROM users WHERE username = ?', req.params.name);
  if (!u) return res.status(404).json({ error: 'Player not found' });
  const rank = q.get('SELECT COUNT(*) + 1 AS r FROM users WHERE rating > ? AND wins + losses > 0', u.rating).r;
  const recent = q.all(`SELECT m.id, m.p1, m.p2, m.s1, m.s2, m.winner, m.kind, m.delta1, m.delta2, m.created_at, a.username AS n1, b.username AS n2
    FROM matches m JOIN users a ON a.id = m.p1 LEFT JOIN users b ON b.id = m.p2
    WHERE m.p1 = ?1 OR m.p2 = ?1 ORDER BY m.id DESC LIMIT 15`, u.id).map((m) => {
    const mine = m.p1 === u.id;
    return {
      id: m.id, kind: m.kind, at: m.created_at, opponent: mine ? (m.n2 ?? 'CPU') : m.n1,
      score: mine ? [m.s1, m.s2] : [m.s2, m.s1], won: m.winner === u.id, delta: mine ? m.delta1 : m.delta2,
    };
  });
  res.json({ user: publicUser(u), rank: u.wins + u.losses > 0 ? rank : null, recent });
});

app.use('/vendor/three', express.static(fileURLToPath(new URL('../node_modules/three/build', import.meta.url))));
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Server error' }); });

const server = createServer(app);
attach(server);
const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`Street Pong running on http://localhost:${port}`));
