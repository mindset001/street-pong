// Two real Chrome instances (fake microphone) spectate a bot-played game and talk over WebRTC.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import assert from 'node:assert/strict';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4100 + Math.floor(Math.random() * 300);
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, DB_FILE: ':memory:', JWT_SECRET: 't' }, stdio: 'pipe' });
await new Promise((r) => srv.stdout.on('data', (d) => String(d).includes('running') && r()));
const procs = [srv];
const end = (c) => { procs.forEach((p) => p.kill()); process.exit(c); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reg = async (u) => (await fetch(`http://localhost:${PORT}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: 'secret1' }) })).json();

async function browser(i, token) {
  const dbg = 9900 + Math.floor(Math.random() * 90) + i * 100;
  procs.push(spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--user-data-dir=${process.env.TMPDIR || '/tmp'}/voice-${dbg}`, 'about:blank'], { stdio: 'ignore' }));
  let tabs; for (let k = 0; k < 50 && !tabs; k++) { try { tabs = await (await fetch(`http://localhost:${dbg}/json`)).json(); } catch { await sleep(200); } }
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.on('open', r));
  let id = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) pend.get(m.id)(m); });
  const cdp = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result.result.value; };
  const until = async (e, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(e)) return; await sleep(150); } throw new Error('timeout: ' + e + ' | page: ' + JSON.stringify(await ev('(document.querySelector("#live")||{}).outerHTML').catch(() => '?'))); };
  await cdp('Page.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `window.__pcs = []; const P = window.RTCPeerConnection; window.RTCPeerConnection = function (...a) { const pc = new P(...a); window.__pcs.push(pc); return pc; }; window.RTCPeerConnection.prototype = P.prototype;` });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `http://localhost:${PORT}/` }); await sleep(800);
  await ev(`localStorage.setItem('token', ${JSON.stringify(token)}); location.reload()`);
  await until(`document.body.innerText.includes('Welcome')`);
  return { ev, until, shot: async (f) => { const r = await cdp('Page.captureScreenshot'); (await import('node:fs')).writeFileSync(f, Buffer.from(r.result.data, 'base64')); } };
}

try {
  const [p1, p2, s1, s2, p3] = await Promise.all(['pl1', 'pl2', 'spec1', 'spec2', 'pl3'].map(reg));
  const bots = [p1, p2, p3].map((u) => { const ws = new WebSocket(`ws://localhost:${PORT}/ws`); ws.on('open', () => ws.send(JSON.stringify({ t: 'auth', token: u.token }))); return ws; });
  await sleep(500);
  // spec1 creates a competition (so becomes the host); pl1 and pl2 play its only match
  const call = async (path, tok, body) => (await fetch(`http://localhost:${PORT}/api/competitions${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: body && JSON.stringify(body) })).json();
  const comp = await call('', s1.token, { name: 'Host Cup', size: 4 });
  for (const u of [p1, p2, p3]) await call(`/${comp.id}/join`, u.token, {});
  const det = await call(`/${comp.id}`, s1.token); // full -> started automatically
  const match = det.rounds[0].find((m) => ![m.p1.username, m.p2.username].includes('spec1'));
  const names = { pl1: bots[0], pl2: bots[1], pl3: bots[2] };
  for (const pl of [match.p1, match.p2]) names[pl.username].send(JSON.stringify({ t: 'comp_ready', matchId: match.id }));
  await sleep(500);
  const [A, B] = [await browser(0, s1.token), await browser(1, s2.token)];
  for (const X of [A, B]) {
    await X.until(`document.querySelector('#live')?.innerText.includes(' vs ')`);
    await X.ev(`[...document.querySelectorAll('#live button')].find((b) => b.textContent === 'Watch').click()`);
    await X.until(`!document.querySelector('#hud').hidden && document.querySelector('#hud-leave').textContent === 'Stop watching'`);
  }
  await A.ev(`[...document.querySelectorAll('#voice button')].find((b) => b.textContent.includes('Join voice')).click()`);
  await A.until(`document.querySelector('#voice').innerText.includes('just you')`);
  await B.ev(`[...document.querySelectorAll('#voice button')].find((b) => b.textContent.includes('Join voice')).click()`);
  for (const X of [A, B]) {
    await X.until(`window.__pcs.length === 1 && window.__pcs[0].connectionState === 'connected'`);
    await X.until(`(async () => { const st = await window.__pcs[0].getStats(); let n = 0; st.forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'audio') n += r.bytesReceived; }); return n > 0; })()`);
  }
  assert.match(await A.ev(`document.querySelector('#voice').innerText`), /spec2/);
  // text chat: spec2 -> everyone
  await B.ev(`document.querySelector('#chat .bar button').click()`);
  await B.ev(`(() => { const i = document.querySelector('#chat input'); i.value = 'hi from spec2'; i.form.requestSubmit(); })()`);
  await A.until(`document.querySelector('#chat .log').innerText.includes('spec2: hi from spec2')`);
  // host (spec1) is offered Mute all, spec2 is not
  assert.equal(await B.ev(`[...document.querySelectorAll('#chat button')].some((b) => b.textContent.includes('Mute all'))`), false);
  await A.ev(`[...document.querySelectorAll('#chat button')].find((b) => b.textContent.includes('Mute all')).click()`);
  await B.until(`document.querySelector('#chat input').disabled && document.querySelector('#voice').innerText.includes('Muted by host')`);
  assert.equal(await B.ev(`window.__pcs.length === 1`), true);
  await A.ev(`[...document.querySelectorAll('#chat button')].find((b) => b.textContent.includes('Unmute all')).click()`);
  await B.until(`!document.querySelector('#chat input').disabled && !document.querySelector('#voice').innerText.includes('Muted by host')`);
  if (process.env.SHOT) await A.shot(process.env.SHOT);
  console.log('voice ok');
  end(0);
} catch (e) { console.error(e); end(1); }
