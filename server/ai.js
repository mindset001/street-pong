import { C, clamp, predictCrossing } from './physics.js';

export const LEVELS = {
  easy:   { speed: 1.3, err: 0.2, react: 0.35, power: 0.45, miss: 0.3 },
  medium: { speed: 2.2, err: 0.12, react: 0.18, power: 0.7, miss: 0.15 },
  hard:   { speed: 3.2, err: 0.09, react: 0.06, power: 1, miss: 0.07 },
};

/** Drives one paddle of a Game. Call update() every tick. */
export class AI {
  constructor(game, p, level = 'medium') {
    this.g = game; this.p = p; this.cfg = LEVELS[level] || LEVELS.medium;
    this.aim = { x: 0, y: 0.25 }; this.swing = 0; this.wait = 0; this.noise = { x: 0, y: 0 };
  }

  update(dt) {
    const g = this.g, pad = g.paddle[this.p], b = g.ball, cfg = this.cfg;
    const zp = this.p === 0 ? C.PLANE : -C.PLANE;
    if (g.state === 'serve' && g.server === this.p) {
      this.wait += dt;
      this.moveTo(0, 0.2, dt);
      if (this.wait > 0.9) { g.serve(); this.wait = 0; }
      return;
    }
    this.wait = 0;
    const incoming = g.state === 'rally' && g.lastHitter !== this.p && (this.p === 0 ? b.vz > 0 : b.vz < 0);
    if (incoming) {
      const pr = predictCrossing(b, zp);
      if (pr && pr.t > 0) {
        if (!this.targetKey || Math.abs(this.targetKey - pr.x) > 0.5) {
          this.noise = { x: (Math.random() - 0.5) * 2 * cfg.err, y: (Math.random() - 0.5) * 2 * cfg.err };
          if (Math.random() < cfg.miss) { this.noise.x += (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.3); }
          this.targetKey = pr.x;
        }
        // Don't react until the ball is close enough in time.
        if (pr.t < 1.4 - cfg.react * 2) this.aim = { x: pr.x + this.noise.x, y: pr.y + this.noise.y };
      }
    } else {
      this.targetKey = null;
      this.aim = { x: this.aim.x * 0.98, y: 0.2 };
    }
    // Pick a fresh shot (placement + power) for the next contact.
    if (!incoming) {
      pad.aimX = (Math.random() * 2 - 1) * 0.62;
      pad.power = Math.random() * cfg.power;
    }
    this.moveTo(this.aim.x, this.aim.y, dt);
  }

  moveTo(wx, wy, dt) {
    const g = this.g, pad = g.paddle[this.p];
    const dx = wx - pad.tx * 1, dy = wy - pad.ty;
    const d = Math.hypot(dx, dy), max = this.cfg.speed * dt;
    const k = d > max ? max / d : 1;
    const nx = pad.tx + dx * k, ny = pad.ty + dy * k;
    // setPaddleTarget takes player-local x
    g.setPaddleTarget(this.p, nx * (this.p === 0 ? 1 : -1), ny);
  }
}
