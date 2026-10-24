// Drives the real UI in headless Chrome over CDP: sign up, play vs CPU, create a competition, view leaderboard.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import assert from 'node:assert/strict';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 3600 + Math.floor(Math.random() * 300), DBG = 9300 + Math.floor(Math.random() * 300);
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, DB_FILE: ':memory:', JWT_SECRET: 't' }, stdio: 'pipe' });
await new Promise((r) => srv.stdout.on('data', (d) => String(d).includes('running') && r()));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DBG}`, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720', `--user-data-dir=${process.env.TMPDIR || '/tmp'}/pong-ui-${DBG}`, 'about:blank'], { stdio: 'ignore' });
const end = (c) => { chrome.kill(); srv.kill(); process.exit(c); };
let tabs;
for (let i = 0; i < 50 && !tabs; i++) { try { tabs = await (await fetch(`http://localhost:${DBG}/json`)).json(); } catch { await new Promise((r) => setTimeout(r, 200)); } }
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.on('open', r));
let id = 0; const pend = new Map(); const errors = [];
ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) pend.get(m.id)(m); else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value).join(' ')); });
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result.result.value; };
const until = async (expr, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error('timeout: ' + expr); };
await cdp('Runtime.enable'); await cdp('Page.enable');
try {
  await cdp('Page.navigate', { url: `http://localhost:${PORT}/` });
  await until(`!!document.querySelector('.auth')`);
  await ev(`document.querySelectorAll('.tabs button')[1].click()`);
  await ev(`(() => { const [u, p] = document.querySelectorAll('.auth input'); u.value = 'tester'; p.value = 'secret1'; document.querySelector('.auth form').requestSubmit(); })()`);
  await until(`document.body.innerText.includes('Welcome, tester')`);
  await until(`document.querySelector('#net-dot').classList.contains('on')`);
  // vs CPU
  await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Play').click()`);
  await until(`!document.querySelector('#hud').hidden && document.querySelector('#hud-msg').textContent.length > 0`);
  await new Promise((r) => setTimeout(r, 800));
  assert.match(await ev(`document.querySelector('#hud').innerText`), /tester \(you\)/);
  await ev(`document.querySelector('#gl').dispatchEvent(new PointerEvent('pointerdown', { clientX: 640, clientY: 520 }))`); // serve
  await new Promise((r) => setTimeout(r, 1500));
  await ev(`window.confirm = () => true; document.querySelector('#hud-leave').click()`);
  await until(`document.querySelector('#modal .big')?.textContent === 'DEFEAT'`);
  await ev(`[...document.querySelectorAll('#modal button')].find((b) => b.textContent === 'Menu').click()`);
  await until(`document.body.innerText.includes('Welcome, tester')`);
  // competition
  await ev(`location.hash = '#/competitions'`);
  await until(`!!document.querySelector('form input[maxlength="40"]')`);
  await ev(`(() => { document.querySelector('form input[maxlength="40"]').value = 'UI Cup'; document.querySelector('form input[maxlength="40"]').form.requestSubmit(); })()`);
  await until(`document.body.innerText.includes('UI Cup') && document.body.innerText.includes('Start now')`);
  const code = await ev(`document.body.innerText.match(/Invite code\\s+([A-Z2-9]{6})/)?.[1]`);
  assert.ok(code, 'invite code shown');
  await ev(`location.hash = '#/join/${code}'`);
  await until(`location.hash.startsWith('#/competition/') && document.body.innerText.includes('UI Cup')`);
  await ev(`location.hash = '#/leaderboard'`);
  await until(`!!document.querySelector('table') || document.body.innerText.includes('No ranked games')`);
  assert.deepEqual(errors, [], 'no console errors');
  console.log('ui ok');
  end(0);
} catch (e) { console.error(e, errors); end(1); }
