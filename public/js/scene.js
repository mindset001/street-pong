import * as THREE from '/vendor/three/three.module.js';

// Must match server/physics.js
export const W = { HALF_L: 1.37, HALF_W: 0.7625, NET_H: 0.1525, PLANE: 1.72, FLOOR: -0.76, X_LIM: 1.3, Y_MIN: -0.3, Y_MAX: 0.8 };

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

function makePaddle(rubber) {
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.014, 32), new THREE.MeshStandardMaterial({ color: rubber, roughness: 0.55, emissive: rubber, emissiveIntensity: 0.22 }));
  face.rotation.x = Math.PI / 2; face.castShadow = true;
  const wood = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.01, 32), new THREE.MeshStandardMaterial({ color: 0xd9b27c, roughness: 0.8 }));
  wood.rotation.x = Math.PI / 2; wood.position.z = 0.011;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.018), new THREE.MeshStandardMaterial({ color: 0xc89a5e, roughness: 0.8 }));
  handle.position.set(0, -0.145, 0.008); handle.castShadow = true;
  g.add(face, wood, handle);
  return g;
}

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x0b1020);
    s.fog = new THREE.Fog(0x0b1020, 6, 16);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.05, 40);
    this.mode = 'menu'; this.idx = 0; this.t = 0;
    this.ballTarget = new THREE.Vector3(0, 0.3, 0);
    this.padTarget = [new THREE.Vector2(0, 0.2), new THREE.Vector2(0, 0.2)];
    this.mine = new THREE.Vector2(0, 0.2);
    this.build();
    this.ray = new THREE.Raycaster();
    this.resize(); addEventListener('resize', () => this.resize());
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  build() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xaec6ff, 0x1a1030, 0.7));
    const key = new THREE.SpotLight(0xfff2dd, 62, 14, 0.8, 0.5, 1.6);
    key.position.set(0, 4.2, 0); key.target.position.set(0, 0, 0);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0004;
    s.add(key, key.target);
    const rim1 = new THREE.PointLight(0xff4d8d, 12, 9); rim1.position.set(-3.5, 1.2, -3);
    const rim2 = new THREE.PointLight(0x38d6ff, 12, 9); rim2.position.set(3.5, 1.2, 3);
    s.add(rim1, rim2);
    for (const z of [-3.2, 3.2]) { const f = new THREE.PointLight(0xffffff, 4, 8); f.position.set(0, 1.5, z); s.add(f); }

    // floor with a court-like grid
    const floorTex = canvasTex(512, 512, (c, w, h) => {
      c.fillStyle = '#141a2e'; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(120,150,255,.18)'; c.lineWidth = 2;
      for (let i = 0; i <= 8; i++) { c.beginPath(); c.moveTo(i * w / 8, 0); c.lineTo(i * w / 8, h); c.moveTo(0, i * h / 8); c.lineTo(w, i * h / 8); c.stroke(); }
    }, [6, 6]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = W.FLOOR; floor.receiveShadow = true;
    s.add(floor);

    // table
    const top = new THREE.Mesh(new THREE.BoxGeometry(W.HALF_W * 2, 0.03, W.HALF_L * 2), new THREE.MeshStandardMaterial({ color: 0x1650a8, roughness: 0.4, metalness: 0.05 }));
    top.position.y = -0.015; top.receiveShadow = true; top.castShadow = true;
    s.add(top);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xf4f6ff });
    const line = (w, l, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), lineMat); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.0007, z); s.add(m); };
    const lw = 0.02;
    line(lw, W.HALF_L * 2, -W.HALF_W + lw / 2, 0); line(lw, W.HALF_L * 2, W.HALF_W - lw / 2, 0);
    line(W.HALF_W * 2, lw, 0, -W.HALF_L + lw / 2); line(W.HALF_W * 2, lw, 0, W.HALF_L - lw / 2);
    line(0.006, W.HALF_L * 2, 0, 0);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x20242e, roughness: 0.6, metalness: 0.4 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.73, 0.06), legMat);
      leg.position.set(sx * (W.HALF_W - 0.1), -0.03 - 0.365, sz * (W.HALF_L - 0.2)); leg.castShadow = true; s.add(leg);
    }
    // net
    const netTex = canvasTex(256, 32, (c, w, h) => {
      c.clearRect(0, 0, w, h); c.strokeStyle = 'rgba(235,240,255,.75)'; c.lineWidth = 1;
      for (let x = 0; x <= w; x += 8) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
      for (let y = 0; y <= h; y += 8) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
      c.fillStyle = '#fff'; c.fillRect(0, 0, w, 4);
    });
    const net = new THREE.Mesh(new THREE.PlaneGeometry(1.83, W.NET_H), new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    net.position.y = W.NET_H / 2; s.add(net);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, W.NET_H + 0.02, 8), new THREE.MeshStandardMaterial({ color: 0xcccccc }));
      post.position.set(sx * 0.9125, W.NET_H / 2, 0); s.add(post);
    }

    // ball + shadow trail
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.035, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffa51f, roughness: 0.3, emissive: 0x552200, emissiveIntensity: 0.6 }));
    this.ball.castShadow = true; s.add(this.ball);
    this.trail = [];
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.03 * (1 - i / 12), 8, 6), new THREE.MeshBasicMaterial({ color: 0xffa51f, transparent: true, opacity: 0.28 * (1 - i / 10) }));
      s.add(m); this.trail.push(m);
    }
    // paddles: index 0 stands at +z (red), index 1 at -z (dark)
    this.paddles = [makePaddle(0xd7263d), makePaddle(0x22262e)];
    this.paddles[0].position.z = W.PLANE; this.paddles[1].position.z = -W.PLANE; this.paddles[1].rotation.y = Math.PI;
    s.add(...this.paddles);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait screens are narrow: widen the FOV and pull the camera back so the whole
    // table width (and every reachable paddle position) stays on screen.
    const a = w / h;
    this.portrait = THREE.MathUtils.clamp((1.3 - a) / 0.8, 0, 1); // 0 = landscape, 1 = tall phone
    this.camera.fov = 52 + 12 * this.portrait;
    this.camera.updateProjectionMatrix();
  }

  setMode(mode, idx = 0) {
    this.mode = mode; this.idx = idx;
    this.canvas.style.touchAction = mode === 'game' ? 'none' : 'auto';
    if (mode === 'watch') this.idx = -1;
  }

  /** Mouse/touch -> player-local paddle coords by intersecting the paddle plane. */
  pointerToPaddle(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera({ x: ((cx - r.left) / r.width) * 2 - 1, y: -((cy - r.top) / r.height) * 2 + 1 }, this.camera);
    const zp = this.idx === 0 ? W.PLANE : -W.PLANE;
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    if (Math.abs(d.z) < 1e-4) return null;
    const t = (zp - o.z) / d.z;
    if (t <= 0) return null;
    const wx = o.x + d.x * t, wy = o.y + d.y * t;
    const x = Math.max(-W.X_LIM, Math.min(W.X_LIM, wx * (this.idx === 0 ? 1 : -1)));
    const y = Math.max(W.Y_MIN, Math.min(W.Y_MAX, wy));
    this.mine.set(x * (this.idx === 0 ? 1 : -1), y); // world coords for rendering
    return { x, y };
  }

  applySnapshot(s) {
    this.ballTarget.set(s.b[0], s.b[1], s.b[2]);
    this.padTarget[0].set(s.p[0][0], s.p[0][1]);
    this.padTarget[1].set(s.p[1][0], s.p[1][1]);
  }

  reset() {
    this.ball.position.set(0, 0.3, 0); this.ballTarget.copy(this.ball.position);
    this.trail.forEach((m) => m.position.copy(this.ball.position));
  }

  frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000)); this.last = now; this.t += dt;
    const cam = this.camera;
    if (this.mode === 'game' || this.mode === 'watch') {
      const sgn = this.idx === 0 ? 1 : -1;
      const bx = this.ball.position.x;
      if (this.mode === 'watch') { // audience: stand to the side of the table and drift gently
        const a = 0.55 + Math.sin(this.t * 0.2) * 0.12, d = 3.9 + 1.6 * this.portrait;
        cam.position.set(Math.sin(a) * d, 1.55 + 0.3 * this.portrait, Math.cos(a) * d);
        cam.lookAt(0, -0.1, 0);
      } else {
        cam.position.set(bx * 0.18, 1.0 + 0.35 * this.portrait, sgn * (3.25 + 1.75 * this.portrait));
        cam.lookAt(bx * 0.1, -0.12, -sgn * 0.35);
      }
      const k = 1 - Math.exp(-dt * 55);
      this.ball.position.lerp(this.ballTarget, k);
      for (const p of [0, 1]) {
        const g = this.paddles[p];
        const tgt = p === this.idx ? this.mine : this.padTarget[p];
        const dx = tgt.x - g.position.x, dy = tgt.y - g.position.y;
        g.position.x += dx * (1 - Math.exp(-dt * 40)); g.position.y += dy * (1 - Math.exp(-dt * 40));
        // lean into movement: a little roll and tilt-forward for a swing feel
        const face = p === 0 ? 0 : Math.PI;
        g.rotation.set(-0.25 + THREE.MathUtils.clamp(dy * 2, -0.5, 0.5), face, THREE.MathUtils.clamp(-dx * 2.5 * (p === 0 ? 1 : -1), -0.7, 0.7), 'YXZ');
      }
    } else {
      // menu: slow orbit
      const a = this.t * 0.12;
      cam.position.set(Math.sin(a) * 3.6, 1.5, Math.cos(a) * 3.6);
      cam.lookAt(0, -0.1, 0);
      // demo rally
      const p = (this.t % 1.6) / 1.6, dir = Math.floor(this.t / 1.6) % 2 ? 1 : -1;
      this.ball.position.set(Math.sin(this.t * 2) * 0.3, 0.03 + Math.abs(Math.sin(p * Math.PI * 2)) * 0.22, dir * (1.6 - 3.2 * p));
      for (const [i, z] of [[0, W.PLANE], [1, -W.PLANE]]) { this.paddles[i].position.set(Math.sin(this.t + i) * 0.3, 0.15, z); this.paddles[i].rotation.set(-0.25, i ? Math.PI : 0, 0); }
    }
    // trail follows the ball
    let prev = this.ball.position;
    for (const m of this.trail) { m.position.lerp(prev, 0.35); prev = m.position; }
    this.renderer.render(this.scene, cam);
    requestAnimationFrame((t) => this.frame(t));
  }
}
