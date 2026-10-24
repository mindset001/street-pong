import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { TEST_URI, dropTestDb } from './helpers.js';

const PORT = 3100 + Math.floor(Math.random() * 500);
const base = `http://localhost:${PORT}`;
const srv = spawn('node', ['src/index.js'], { env: { ...process.env, PORT, MONGODB_URI: TEST_URI, JWT_SECRET: 'test' }, stdio: 'pipe' });
const done = async (code) => { srv.kill(); await dropTestDb().catch(() => {}); process.exit(code); };
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
assert.equal(st.players[1].username, 'Pixel'); assert.equal(st.players[1].cpu, true); assert.equal(st.level, 'easy');
assert.ok(st.players[0].avatar && st.players[0].color && st.players[0].paddle && st.players[0].char?.skin, 'human players carry their look');
assert.ok(st.players[1].char?.shirt, 'CPU has a character too');
const snap = await ca.next((m) => m.t === 's');
assert.equal(snap.st, 'serve');
ca.send({ t: 'leave' });
await ca.next((m) => m.t === 'over');

// player customisation: whitelist only
const opts = (await api('/auth/player-options')).body;
assert.ok(opts.avatars.length > 8 && opts.colors.length && opts.paddles.length);
assert.equal((await api('/auth/player', a.token, { avatar: '<script>', color: opts.colors[0], paddle: opts.paddles[0] }, 'PUT')).status, 400);
assert.equal((await api('/auth/player', a.token, { avatar: opts.avatars[3], color: opts.colors[2], paddle: opts.paddles[4] }, 'PUT')).status, 200);
const me = (await api('/auth/me', a.token)).body.user;
assert.deepEqual([me.avatar, me.color, me.paddle], [opts.avatars[3], opts.colors[2], opts.paddles[4]]);
const ch = Object.fromEntries(Object.entries(opts.char).map(([k, v]) => [k, v[1]]));
assert.equal((await api('/auth/player', a.token, { avatar: opts.avatars[3], color: opts.colors[2], paddle: opts.paddles[4], char: { ...ch, skin: 'javascript:1' } }, 'PUT')).status, 400);
assert.equal((await api('/auth/player', a.token, { avatar: opts.avatars[3], color: opts.colors[2], paddle: opts.paddles[4], char: ch }, 'PUT')).status, 200);
assert.deepEqual((await api('/auth/me', a.token)).body.user.char, ch);
assert.equal((await api('/auth/player', null, { avatar: opts.avatars[0], color: opts.colors[0], paddle: opts.paddles[0] }, 'PUT')).status, 401);

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

// spectators + voice: carol and dave watch alice vs bob
ca.send({ t: 'queue' }); cb.send({ t: 'queue' });
const [ra, rb] = await Promise.all([ca.next((m) => m.t === 'start'), cb.next((m) => m.t === 'start')]);
assert.equal((await api('/live', a.token)).body.games.length, 1);
cc.send({ t: 'watch', gid: ra.gid });
const ws1 = await cc.next((m) => m.t === 'start');
assert.equal(ws1.you, -1); assert.equal(ws1.spectator, true);
await cc.next((m) => m.t === 's'); // spectators receive snapshots
cc.send({ t: 'p', x: 1, y: 1 }); cc.send({ t: 'serve' }); // spectators can't control anything
cc.send({ t: 'voice_join' });
const vp1 = await cc.next((m) => m.t === 'voice_peers'); assert.deepEqual(vp1.peers, []);
cd.send({ t: 'watch', gid: ra.gid }); await cd.next((m) => m.t === 'start');
cd.send({ t: 'voice_join' });
const vp2 = await cd.next((m) => m.t === 'voice_peers'); assert.deepEqual(vp2.peers.map((p) => p.username), ['carol']);
assert.equal((await cc.next((m) => m.t === 'voice_joined')).username, 'dave');
cd.send({ t: 'rtc', to: c.user.id, data: { sdp: { type: 'offer', sdp: 'x' } } });
assert.equal((await cc.next((m) => m.t === 'rtc')).from, d.user.id);
cb.send({ t: 'rtc', to: c.user.id, data: { c: 1 } }); // bob isn't in voice: relay refused
cb.send({ t: 'voice_join' }); const vp3 = await cb.next((m) => m.t === 'voice_peers'); assert.equal(vp3.peers.length, 2, 'players can join the same room');
cd.send({ t: 'unwatch' }); await cd.next((m) => m.t === 'unwatched');
assert.equal((await cc.next((m) => m.t === 'voice_left' && m.uid === d.user.id)).uid, d.user.id);
cd.send({ t: 'voice_join' }); assert.equal((await cd.next((m) => m.t === 'err')).msg, 'Join a game or watch one first');
ca.send({ t: 'leave' });
const sov = await cc.next((m) => m.t === 'over'); assert.equal(sov.you, -1);
await cc.next((m) => m.t === 'voice_closed');
await Promise.all([ca.next((m) => m.t === 'over'), cb.next((m) => m.t === 'over')]);
cc.msgs.length = cd.msgs.length = 0;

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

// in-game chat + host mute (host = competition creator)
const cc3 = (await api('/competitions', a.token, { name: 'Chat Cup', size: 4 })).body;
await api(`/competitions/${cc3.id}/join`, b.token, {});
const started3 = (await api(`/competitions/${cc3.id}/start`, a.token, {})).body;
const m3 = started3.rounds[0].find((m) => m.p1 && m.p2);
const [x3, y3] = [clients[m3.p1.username], clients[m3.p2.username]];
x3.send({ t: 'comp_ready', matchId: m3.id }); y3.send({ t: 'comp_ready', matchId: m3.id });
const [st1] = await Promise.all([x3.next((q) => q.t === 'start'), y3.next((q) => q.t === 'start')]);
const hostIsPlayer = [m3.p1.username, m3.p2.username].includes('alice');
assert.equal(st1.host, m3.p1.username === 'alice');
cc.send({ t: 'watch', gid: st1.gid }); const wst = await cc.next((q) => q.t === 'start'); assert.equal(wst.host, false); assert.equal(wst.hasHost, true);
cc.send({ t: 'chat', text: '  hello   everyone  ' });
for (const cl of [x3, y3, cc]) assert.equal((await cl.next((q) => q.t === 'chat')).text, 'hello everyone');
cc.send({ t: 'mute_all', on: true });
assert.match((await cc.next((q) => q.t === 'err')).msg, /Only the competition host/);
const host = clients.alice;
host.send({ t: 'mute_all', on: true });
for (const cl of [x3, y3, cc]) assert.equal((await cl.next((q) => q.t === 'muted')).on, true);
cc.send({ t: 'chat', text: 'can anyone hear me' });
assert.equal((await cc.next((q) => q.t === 'err')).msg, 'Chat is muted by the host');
host.send({ t: 'chat', text: 'host can still talk' });
assert.equal((await cc.next((q) => q.t === 'chat')).host, true);
host.send({ t: 'mute_all', on: false });
await cc.next((q) => q.t === 'muted');
cc.send({ t: 'chat', text: 'back' }); assert.equal((await cc.next((q) => q.t === 'chat')).text, 'back');
for (let i = 0; i < 8; i++) cc.send({ t: 'chat', text: 'spam' + i });
assert.equal((await cc.next((q) => q.t === 'err')).msg, 'Slow down a little');
y3.send({ t: 'leave' }); await Promise.all([x3.next((q) => q.t === 'over'), y3.next((q) => q.t === 'over'), cc.next((q) => q.t === 'over')]);
// ranked games have no host
ca.msgs.length = cb.msgs.length = 0;

console.log('e2e ok');
done(0);
