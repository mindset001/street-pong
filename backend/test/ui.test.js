// Drives the real UI in headless Chrome over CDP: sign up, play vs CPU, create a competition, view leaderboard.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { TEST_URI, dropTestDb } from './helpers.js';
import assert from 'node:assert/strict';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 3600 + Math.floor(Math.random() * 300), DBG = 9300 + Math.floor(Math.random() * 300);
const srv = spawn('node', ['src/index.js'], { env: { ...process.env, PORT, MONGODB_URI: TEST_URI, JWT_SECRET: 't' }, stdio: 'pipe' });
await new Promise((r) => srv.stdout.on('data', (d) => String(d).includes('running') && r()));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DBG}`, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720', `--user-data-dir=${process.env.TMPDIR || '/tmp'}/pong-ui-${DBG}`, 'about:blank'], { stdio: 'ignore' });
const end = async (c) => { chrome.kill(); srv.kill(); await dropTestDb().catch(() => {}); process.exit(c); };
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
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const type = async (sel, text) => { await ev(`document.querySelector(${JSON.stringify(sel)}).focus()`); await cdp('Input.insertText', { text }); };
try {
  await cdp('Page.navigate', { url: `http://localhost:${PORT}/` });
  await until(`!!document.querySelector('#auth_username')`);
  await ev(`[...document.querySelectorAll('[role=tab]')].find((t) => t.textContent === 'Create account').click()`);
  await type('#auth_username', 'tester');
  await type('#auth_password', 'secret1');
  // eye icon toggles password visibility
  assert.equal(await ev(`document.querySelector('#auth_password').type`), 'password');
  await click('.ant-input-password-icon');
  assert.equal(await ev(`document.querySelector('#auth_password').type`), 'text');
  await click('.ant-input-password-icon');
  assert.equal(await ev(`document.querySelector('#auth_password').type`), 'password');
  await click('[data-testid=auth-submit]');
  await until(`document.body.innerText.includes('Welcome, tester')`);
  await until(`document.querySelector('[data-testid=net-dot]').classList.contains('on')`);
  // new accounts are invited to set up their player
  await until(`!!document.querySelector('[data-testid=char-preview] canvas')`); // 3D preview rendered
  await ev(`document.querySelectorAll('[data-testid=player-editor] .ant-segmented-item')[2].click()`); // hair style: long
  await ev(`document.querySelectorAll('[data-testid=player-editor] .swatch')[4].click()`); // skin tone
  await ev(`[...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.startsWith('Avatar')).click()`);
  await until(`!!document.querySelector('[data-testid=player-editor] .emoji')`);
  const emoji = await ev(`document.querySelectorAll('[data-testid=player-editor] .emoji')[5].textContent`);
  await ev(`document.querySelectorAll('[data-testid=player-editor] .emoji')[5].click()`);
  await click('[data-testid=player-save]');
  await until(`!document.querySelector('[data-testid=player-editor]')`);
  assert.equal(await ev(`document.querySelector('.me-name .ant-avatar').textContent`), emoji, 'saved avatar shows in the header');
  const saved = await ev(`fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } }).then((r) => r.json())`);
  assert.equal(saved.user.char.hairStyle, 'long'); assert.equal(saved.user.char.skin, '#8d5524', 'character saved');
  // vs CPU: loader first, then the HUD
  await click('[data-testid=play-cpu]');
  await until(`!!document.querySelector('[data-testid=hud]') && document.querySelector('#hud-msg').textContent.length > 0`);
  assert.match(await ev(`document.querySelector('[data-testid=hud]').innerText`), /tester \(you\)/);
  assert.match(await ev(`document.querySelector('[data-testid=hud]').innerText`), /Rally/, 'CPU has a proper name');
  assert.equal(await ev(`!!document.querySelector('[data-testid=vs-intro]')`), true, 'who is playing is shown');
  await ev(`document.querySelector('#gl').dispatchEvent(new PointerEvent('pointerdown', { clientX: 640, clientY: 520 }))`); // serve
  await new Promise((r) => setTimeout(r, 1500));
  await click('[data-testid=hud-leave]');
  await until(`!!document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')`);
  await click('.ant-modal-confirm-btns .ant-btn-primary');
  await until(`document.querySelector('[data-testid=result-title]')?.textContent === 'DEFEAT'`);
  await click('[data-testid=result-menu]');
  await until(`document.body.innerText.includes('Welcome, tester') && !document.querySelector('[data-testid=result-title]')`);
  // competition + invite code
  await ev(`location.hash = '#/competitions'`);
  await until(`!!document.querySelector('#create_name')`);
  await type('#create_name', 'UI Cup');
  await click('[data-testid=create-comp]');
  await until(`document.body.innerText.includes('UI Cup') && document.body.innerText.includes('Start now')`);
  const code = await ev(`document.querySelector('[data-testid=invite-code]')?.textContent`);
  assert.match(code, /^[A-Z2-9]{6}$/);
  await ev(`location.hash = '#/join/${code}'`);
  await until(`location.hash.startsWith('#/competition/') && document.body.innerText.includes('UI Cup')`);
  await ev(`location.hash = '#/leaderboard'`);
  await until(`!!document.querySelector('.ant-table')`);
  assert.deepEqual(errors, [], 'no console errors');
  console.log('ui ok');
  await end(0);
} catch (e) { console.error(e, errors, await ev(`document.body.innerText.slice(0,500) + ' | ' + [...document.querySelectorAll('input')].map(i=>i.id+'='+i.value).join(',')`).catch(()=>'')); await end(1); }
