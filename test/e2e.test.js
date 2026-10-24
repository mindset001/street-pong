import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const PORT = 3100 + Math.floor(Math.random() * 500);
const base = `http://localhost:${PORT}`;
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, DB_FILE: ':memory:', JWT_SECRET: 'test' }, stdio: 'pipe' });
const done = (code) => { srv.kill(); process.exit(code); };
process.on('uncaughtException', (e) => { console.error(e); done(1); });
await new Promise((r) => srv.stdout.on('data', (d) => String(d).includes('running') && r()));

const api = async (path, token, body, method) => {
  const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const mk = async (name) => { const r = await api('/auth/register', null, { username: name, password: 'secret1' }); assert.equal(r.status, 200); return r.body; };

class Client {
  constructor(token) { this.msgs = []; this.waiters = []; this.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    this.ws.on('open', () => this.send({ t: 'auth', token }));
    this.ws.on('message', (d) => { const m = JSON.parse(d); this.msgs.push(m); this.waiters = this.waiters.filter((w) => !w(m)); }); }
  send(m) { this.ws.send(JSON.stringify(m)); }
  next(pred, ms = 5000) { const hit = this.msgs.find(pred); if (hit) { this.msgs.splice(this.msgs.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout waiting for message')), ms);
      this.waiters.push((m) => { if (pred(m)) { clearTimeout(t); this.msgs.splice(this.msgs.indexOf(m), 1); res(m); return true; } return false; }); }); }
}

// auth validation
assert.equal((await api('/auth/register', null, { username: 'x', password: 'secret1' })).status, 400);
assert.equal((await api('/auth/login', null, { username: 'nobody', password: 'secret1' })).status, 401);
const [a, b, c, d] = await Promise.all(['alice', 'bob', 'carol', 'dave'].map(mk));
assert.equal((await api('/auth/register', null, { username: 'ALICE', password: 'secret1' })).status, 409, 'usernames are case-insensitive');
assert.equal((await api('/competitions')).status, 200);
assert.equal((await api('/auth/me')).status, 401);

const [ca, cb, cc, cd] = [a, b, c, d].map((u) => new Client(u.token));
await Promise.all([ca, cb, cc, cd].map((x) => x.next((m) => m.t === 'hello')));

// vs CPU: snapshots stream
ca.send({ t: 'ai', level: 'easy' });
const st = await ca.next((m) => m.t === 'start');
assert.equal(st.kind, 'ai');
const snap = await ca.next((m) => m.t === 's');
assert.equal(snap.st, 'serve');
ca.send({ t: 'leave' });
await ca.next((m) => m.t === 'over');

// ranked quick match + forfeit -> ratings move
ca.send({ t: 'queue' }); await ca.next((m) => m.t === 'queued');
cb.send({ t: 'queue' });
const [sa, sb] = await Promise.all([ca.next((m) => m.t === 'start'), cb.next((m) => m.t === 'start')]);
assert.equal(sa.kind, 'ranked'); assert.notEqual(sa.you, sb.you);
ca.send({ t: 'leave' });
const [oa, ob] = await Promise.all([ca.next((m) => m.t === 'over'), cb.next((m) => m.t === 'over')]);
assert.equal(ob.winner, sb.you); assert.equal(oa.delta, -16); assert.equal(ob.delta, 16);
const lb = (await api('/leaderboard', a.token)).body.players;
assert.deepEqual(lb.map((p) => [p.username, p.rating]), [['bob', 1016], ['alice', 984]]);
const prof = (await api('/users/bob', a.token)).body;
assert.equal(prof.rank, 1); assert.equal(prof.recent[0].won, true);

// competition: 4 players, auto-start when full, play through
let comp = (await api('/competitions', a.token, { name: 'Test Cup', size: 4 })).body;
assert.equal(comp.status, 'open');
assert.equal((await api(`/competitions/${comp.id}/join`, a.token, {})).status, 400, 'no double join');
assert.equal((await api(`/competitions/${comp.id}/start`, b.token, {})).status, 403, 'only creator starts');
for (const u of [b, c, d]) assert.equal((await api(`/competitions/${comp.id}/join`, u.token, {})).status, 200);
comp = (await api(`/competitions/${comp.id}`, a.token)).body;
assert.equal(comp.status, 'running'); assert.equal(comp.rounds.length, 2);
const clients = { alice: ca, bob: cb, carol: cc, dave: cd };
const playRound = async (matches) => {
  for (const m of matches) {
    const [x, y] = [clients[m.p1.username], clients[m.p2.username]];
    x.send({ t: 'comp_ready', matchId: m.id }); y.send({ t: 'comp_ready', matchId: m.id });
    const [s1, s2] = await Promise.all([x.next((q) => q.t === 'start'), y.next((q) => q.t === 'start')]);
    assert.equal(s1.kind, 'competition');
    y.send({ t: 'leave' }); // p2 forfeits so p1 advances
    await Promise.all([x.next((q) => q.t === 'over'), y.next((q) => q.t === 'over')]);
  }
};
await playRound(comp.rounds[0]);
comp = (await api(`/competitions/${comp.id}`, a.token)).body;
assert.ok(comp.rounds[1][0].p1 && comp.rounds[1][0].p2 && comp.rounds[1][0].status === 'ready');
await playRound(comp.rounds[1]);
comp = (await api(`/competitions/${comp.id}`, a.token)).body;
assert.equal(comp.status, 'finished'); assert.ok(comp.champion);

// invite codes
assert.match(comp.code, /^[A-Z2-9]{6}$/);
const byCode = await api(`/competitions/code/${comp.code.toLowerCase()}`, a.token);
assert.equal(byCode.body.id, comp.id);
assert.equal((await api('/competitions/code/NOPE12', a.token)).status, 404);

// byes: 3 players in an 8-slot comp
const c2 = (await api('/competitions', a.token, { name: 'Bye Cup', size: 8 })).body;
await api(`/competitions/${c2.id}/join`, b.token, {}); await api(`/competitions/${c2.id}/join`, c.token, {});
const started = (await api(`/competitions/${c2.id}/start`, a.token, {})).body;
assert.equal(started.status, 'running'); assert.equal(started.rounds.length, 2);
assert.equal(started.rounds[0].filter((m) => m.bye).length, 1);

console.log('e2e ok');
done(0);
