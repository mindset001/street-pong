import { API_URL } from './config';
import { tokenStore } from './api';

/** One websocket for the whole app: auth, auto-reconnect, and a tiny pub/sub keyed by message type. */
class Net {
  constructor() { this.ws = null; this.retry = 0; this.handlers = new Map(); this.timer = null; this.connected = false; this.active = false; }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type).delete(fn);
  }
  emit(type, m) { this.handlers.get(type)?.forEach((fn) => fn(m)); if (!type.startsWith('_')) this.handlers.get('*')?.forEach((fn) => fn(m)); } // '*' = server messages only

  connect() {
    this.active = true; clearTimeout(this.timer);
    const token = tokenStore.get();
    if (!token || this.ws) return;
    const base = new URL(API_URL || location.origin);
    const ws = this.ws = new WebSocket(`${base.protocol === 'https:' ? 'wss' : 'ws'}://${base.host}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', token }));
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'hello') { this.retry = 0; this.connected = true; this.emit('_status', { connected: true }); }
      this.emit(m.t, m);
    };
    ws.onclose = (e) => {
      if (this.ws === ws) this.ws = null;
      this.connected = false; this.emit('_status', { connected: false });
      if (e.code === 4002) return this.emit('_authfail', {});
      if (e.code === 4003 || !this.active) return; // replaced by a newer tab / intentionally closed
      this.timer = setTimeout(() => this.connect(), Math.min(8000, 500 * 2 ** this.retry++));
    };
  }

  close() { this.active = false; clearTimeout(this.timer); this.ws?.close(); this.ws = null; this.connected = false; }
  send = (m) => { if (this.ws?.readyState === 1) { this.ws.send(JSON.stringify(m)); return true; } return false; };
}
export const net = new Net();
