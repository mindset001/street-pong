// Server-authoritative table tennis simulation.
// World: y up, table top at y=0, net at z=0. Player 0 stands at +z, player 1 at -z.
export const C = {
  HALF_L: 1.37,
  HALF_W: 0.7625,
  NET_H: 0.1525,
  NET_HALF_W: 0.9125,
  PLANE: 1.72,       // z of each player's paddle plane
  REACH: 0.22,
  G: 9.8,
  REST: 0.88,
  FLOOR: -0.76,
  DT: 1 / 120,
  PADDLE_SPEED: 14,
  X_LIM: 1.3,
  Y_MIN: -0.3,
  Y_MAX: 0.8,
};

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const gauss = () => {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

export class Game {
  constructor({ target = 11 } = {}) {
    this.target = target;
    this.score = [0, 0];
    this.server = Math.random() < 0.5 ? 0 : 1;
    this.first = this.server;
    this.paddle = [
      { x: 0, y: 0.2, tx: 0, ty: 0.2, vx: 0, vy: 0 },
      { x: 0, y: 0.2, tx: 0, ty: 0.2, vx: 0, vy: 0 },
    ];
    this.ball = { x: 0, y: 0.3, z: 0, vx: 0, vy: 0, vz: 0 };
    this.events = [];
    this.over = false;
    this.winner = null;
    this.serveTimer = 0;
    this.startServe();
  }

  /** Player-local (x right-positive from their viewpoint) -> world. */
  setPaddleTarget(p, lx, ly) {
    if (!Number.isFinite(lx) || !Number.isFinite(ly)) return;
    this.paddle[p].tx = clamp(lx, -C.X_LIM, C.X_LIM) * (p === 0 ? 1 : -1);
    this.paddle[p].ty = clamp(ly, C.Y_MIN, C.Y_MAX);
  }

  startServe() {
    this.state = 'serve';
    this.serveTimer = 0;
    this.lastHitter = null;
    this.bounces = 0;
    this.ball.vx = this.ball.vy = this.ball.vz = 0;
    this.holdBall();
  }

  holdBall() {
    const p = this.paddle[this.server];
    this.ball.x = p.x;
    this.ball.y = Math.max(0.12, p.y + 0.08);
    this.ball.z = (this.server === 0 ? 1 : -1) * (C.PLANE - 0.15);
  }

  serve() {
    if (this.state !== 'serve') return;
    this.hit(this.server, true);
    this.state = 'rally';
    this.events.push({ e: 'hit', p: this.server });
  }

  /** Compute outgoing velocity so the ball lands on the opponent's half. */
  hit(p, isServe = false) {
    const b = this.ball, pad = this.paddle[p];
    const dist = Math.hypot(b.x - pad.x, b.y - pad.y);
    const speed = Math.hypot(pad.vx, pad.vy);
    const t = isServe ? 0.25 : (pad.power ?? clamp(speed / 7, 0, 1));
    const sign = p === 0 ? -1 : 1; // direction toward the opponent
    const off = dist / C.REACH;
    const sigma = 0.025 + 0.2 * off * off + 0.05 * t;
    let tx = (pad.aimX ?? clamp((b.x - pad.x) * 3 + pad.vx * 0.12, -0.62, 0.62)) + gauss() * sigma;
    let depth = 0.75 + 0.5 * t + gauss() * sigma;
    if (isServe) { tx = clamp(pad.x * 0.3, -0.5, 0.5) + gauss() * 0.05; depth = 0.9 + Math.random() * 0.3; }
    const tz = sign * depth;
    const hs = 4.2 + 4.5 * t;
    const dx = tx - b.x, dz = tz - b.z;
    const hd = Math.hypot(dx, dz) || 1;
    let T = hd / hs;
    // Raise the arc until it clears the net (net-height is lower when ball is close to it).
    for (let i = 0; i < 40; i++) {
      const vy = (0.5 * C.G * T * T - b.y) / T;
      const tn = (0 - b.z) / ((tz - b.z) / T); // time to reach net plane
      const yn = b.y + vy * tn - 0.5 * C.G * tn * tn;
      if (tn <= 0 || tn >= T || yn > C.NET_H + 0.06 + 0.04 * (1 - t)) break;
      T += 0.025;
    }
    b.vx = dx / T;
    b.vz = dz / T;
    b.vy = (0.5 * C.G * T * T - b.y) / T;
    this.lastHitter = p;
    this.bounces = 0;
  }

  step() {
    const dt = C.DT;
    if (this.over) return;
    // Paddles chase their targets with a speed cap; velocity is smoothed for swing power.
    for (const pad of this.paddle) {
      const dx = pad.tx - pad.x, dy = pad.ty - pad.y;
      const d = Math.hypot(dx, dy), max = C.PADDLE_SPEED * dt;
      const k = d > max ? max / d : 1;
      const nx = pad.x + dx * k, ny = pad.y + dy * k;
      pad.vx += ((nx - pad.x) / dt - pad.vx) * 0.15;
      pad.vy += ((ny - pad.y) / dt - pad.vy) * 0.15;
      pad.x = nx; pad.y = ny;
    }
    const b = this.ball;
    if (this.state === 'serve') {
      this.holdBall();
      this.serveTimer += dt;
      if (this.serveTimer > 12) this.serve(); // keep games moving if a server is AFK
      return;
    }
    if (this.state === 'point') {
      this.pointTimer -= dt;
      this.integrate(dt, false);
      if (this.pointTimer <= 0) {
        if (this.over) return;
        this.startServe();
      }
      return;
    }
    this.integrate(dt, true);
  }

  integrate(dt, live) {
    const b = this.ball;
    const px = b.x, py = b.y, pz = b.z;
    b.vy -= C.G * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;

    // Table bounce
    if (b.vy < 0 && py >= 0 && b.y < 0 && Math.abs(b.x) <= C.HALF_W && Math.abs(b.z) <= C.HALF_L) {
      b.y = 0; b.vy = -b.vy * C.REST;
      b.vx *= 0.98; b.vz *= 0.98;
      this.events.push({ e: 'bounce' });
      if (live) this.onBounce(b.z > 0 ? 0 : 1);
    }
    if (!live) return;

    // Net
    if (pz * b.z < 0 && b.y < C.NET_H && Math.abs(b.x) < C.NET_HALF_W && this.lastHitter !== null) {
      this.events.push({ e: 'net' });
      this.endPoint(1 - this.lastHitter);
      return;
    }
    // Paddle contact: swept check on the paddle plane of whoever the ball is heading to.
    for (const p of [0, 1]) {
      if (this.lastHitter === p || this.bounces < 1) continue;
      const zp = p === 0 ? C.PLANE : -C.PLANE;
      const toward = p === 0 ? b.vz > 0 : b.vz < 0;
      if (!toward || (pz - zp) * (b.z - zp) > 0) continue;
      const f = (zp - pz) / ((b.z - pz) || 1);
      const cx = px + (b.x - px) * f, cy = py + (b.y - py) * f;
      const pad = this.paddle[p];
      if (Math.hypot(cx - pad.x, cy - pad.y) <= C.REACH) {
        b.x = cx; b.y = cy; b.z = zp;
        this.hit(p);
        this.events.push({ e: 'hit', p });
        return;
      }
    }
    // Out of play
    if (b.y < C.FLOOR || Math.abs(b.x) > 4 || Math.abs(b.z) > 4) {
      this.events.push({ e: 'out' });
      this.endPoint(this.bounces === 0 ? 1 - this.lastHitter : this.lastHitter);
    }
  }

  onBounce(side) {
    if (this.lastHitter === null) return;
    if (side === this.lastHitter) return this.endPoint(1 - this.lastHitter); // bounced on own half
    this.bounces++;
    if (this.bounces >= 2) this.endPoint(this.lastHitter); // receiver let it bounce twice
  }

  endPoint(winner) {
    if (this.state === 'point') return;
    this.score[winner]++;
    this.state = 'point';
    this.pointTimer = 1.3;
    this.events.push({ e: 'point', p: winner });
    const [a, b] = this.score;
    if ((a >= this.target || b >= this.target) && Math.abs(a - b) >= 2) {
      this.over = true;
      this.winner = a > b ? 0 : 1;
      return;
    }
    const total = a + b;
    // Serve changes every 2 points; at deuce every point.
    this.server = (a >= this.target - 1 && b >= this.target - 1)
      ? (total % 2 === 0 ? this.first : 1 - this.first)
      : (Math.floor(total / 2) % 2 === 0 ? this.first : 1 - this.first);
  }

  snapshot() {
    const b = this.ball;
    const r = (n) => Math.round(n * 1000) / 1000;
    const s = {
      t: 's',
      b: [r(b.x), r(b.y), r(b.z)],
      p: [[r(this.paddle[0].x), r(this.paddle[0].y)], [r(this.paddle[1].x), r(this.paddle[1].y)]],
      sc: this.score, sv: this.server, st: this.over ? 'over' : this.state,
    };
    if (this.events.length) { s.ev = this.events; this.events = []; }
    return s;
  }
}

/** Predict where the ball will cross a paddle plane (for the AI). */
export function predictCrossing(ball, zp, maxT = 3) {
  let { x, y, z, vx, vy, vz } = ball;
  const dt = C.DT;
  let bounced = false;
  for (let t = 0; t < maxT; t += dt) {
    const pz = z;
    vy -= C.G * dt; x += vx * dt; y += vy * dt; z += vz * dt;
    if (vy < 0 && y < 0 && Math.abs(x) <= C.HALF_W && Math.abs(z) <= C.HALF_L) { y = 0; vy = -vy * C.REST; vx *= 0.98; vz *= 0.98; bounced = true; }
    if ((pz - zp) * (z - zp) <= 0 && pz !== z) return { x, y, t, bounced };
    if (y < C.FLOOR) break;
  }
  return null;
}
