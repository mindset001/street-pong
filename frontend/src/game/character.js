import * as THREE from 'three';

// A procedural low-poly player. Local frame: feet on y=0, facing +z, right hand at -x.
// The right arm is solved with a 2-bone IK so the hand always holds the paddle's grip.

const UP = new THREE.Vector3(0, 1, 0);
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.65, ...extra });
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

const ARM = { upper: 0.3, fore: 0.31 };
const SHOULDER_X = 0.2, SHOULDER_Y = 0.52;

/** Positions a unit cylinder so it spans A -> B. */
function span(mesh, A, B) {
  tmpA.subVectors(B, A);
  const len = tmpA.length() || 1e-4;
  mesh.position.copy(A).addScaledVector(tmpA, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, tmpA.divideScalar(len));
  mesh.scale.set(1, len, 1);
}

/** 2-bone IK in a single frame. Overlong reaches stretch the bones a little instead of detaching the hand. */
function solveArm(S, T, l1, l2, pole, elbowOut) {
  const dir = new THREE.Vector3().subVectors(T, S);
  const d = Math.max(0.05, dir.length());
  dir.divideScalar(d);
  const k = Math.max(1, d / ((l1 + l2) * 0.995));
  const a = l1 * k, b = l2 * k;
  const x = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  const perp = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  elbowOut.copy(S).addScaledVector(dir, x).addScaledVector(perp, h);
}

export class Character {
  constructor(spec) {
    this.group = new THREE.Group();
    this.upper = new THREE.Group();
    this.group.add(this.upper);
    this.t = Math.random() * 10;
    this.lean = 0; this.twist = 0;
    this.poleR = new THREE.Vector3(-0.5, -1, -0.35).normalize();
    this.poleL = new THREE.Vector3(0.5, -1, -0.35).normalize();
    this.elbow = [new THREE.Vector3(), new THREE.Vector3()];
    this.setSpec(spec);
  }

  clear() {
    this.upper.clear();
    for (const c of [...this.group.children]) if (c !== this.upper) this.group.remove(c);
    this.group.traverse((o) => { o.geometry?.dispose(); if (o.material) o.material.dispose(); });
  }

  setSpec(spec) {
    this.spec = spec;
    this.clear();
    const { skin, hairStyle, hair, shirt, shorts, accessory } = spec;
    const g = this.group, u = this.upper;
    const add = (parent, geo, color, pos, extra) => {
      const m = new THREE.Mesh(geo, mat(color, extra));
      m.position.set(...pos); m.castShadow = true; parent.add(m); return m;
    };
    const cyl = (r, color) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 12), mat(color)); m.castShadow = true; g.add(m); return m; };
    const ball = (r, color) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat(color)); m.castShadow = true; g.add(m); return m; };

    // legs, shorts, shoes
    for (const sx of [-1, 1]) {
      const leg = cyl(0.06, skin); span(leg, new THREE.Vector3(sx * 0.1, 0.5, 0), new THREE.Vector3(sx * 0.1, 0.08, 0));
      add(g, new THREE.CylinderGeometry(0.095, 0.105, 0.26, 14), shorts, [sx * 0.1, 0.68, 0]);
      add(g, new THREE.BoxGeometry(0.12, 0.07, 0.24), '#f3f4f6', [sx * 0.1, 0.035, 0.05], { roughness: 0.5 });
    }
    add(g, new THREE.BoxGeometry(0.34, 0.12, 0.2), shorts, [0, 0.8, 0]);

    // torso pivots at the hips so the body can lean toward low shots
    u.position.set(0, 0.85, 0);
    const torso = add(u, new THREE.CapsuleGeometry(0.16, 0.3, 6, 14), shirt, [0, 0.26, 0]); torso.scale.z = 0.68;
    add(u, new THREE.CylinderGeometry(0.045, 0.05, 0.09, 10), skin, [0, 0.58, 0]);
    add(u, new THREE.SphereGeometry(0.115, 20, 16), skin, [0, 0.7, 0]);
    for (const sx of [-1, 1]) {
      add(u, new THREE.SphereGeometry(0.014, 8, 6), '#111827', [sx * 0.042, 0.708, 0.105], { roughness: 0.3 });
      add(u, new THREE.SphereGeometry(0.022, 8, 6), skin, [sx * 0.117, 0.7, 0]);
    }
    add(u, new THREE.BoxGeometry(0.035, 0.012, 0.01), '#7c2d12', [0, 0.662, 0.113]); // mouth

    // hair
    const head = new THREE.Vector3(0, 0.7, 0);
    const cap = (r, thetaLen) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, thetaLen), mat(hair, { roughness: 0.9 })); m.position.copy(head); m.castShadow = true; u.add(m); return m; };
    const back = (r) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10, Math.PI, Math.PI, 0, Math.PI * 0.78), mat(hair, { roughness: 0.9 })); m.position.copy(head); m.castShadow = true; u.add(m); return m; };
    if (hairStyle === 'short') { cap(0.124, Math.PI * 0.5); back(0.123); }
    else if (hairStyle === 'buzz') cap(0.119, Math.PI * 0.5);
    else if (hairStyle === 'long') { cap(0.124, Math.PI * 0.5); back(0.123); add(u, new THREE.BoxGeometry(0.24, 0.3, 0.07), hair, [0, 0.55, -0.095], { roughness: 0.9 }); }
    else if (hairStyle === 'ponytail') { cap(0.124, Math.PI * 0.5); back(0.123); const t = add(u, new THREE.CapsuleGeometry(0.035, 0.16, 6, 8), hair, [0, 0.66, -0.16], { roughness: 0.9 }); t.rotation.x = -0.5; }
    else if (hairStyle === 'afro') add(u, new THREE.SphereGeometry(0.165, 18, 14), hair, [0, 0.745, -0.05], { roughness: 1 });

    // accessory (uses the shirt colour so it matches the outfit)
    if (accessory === 'headband') { const m = add(u, new THREE.TorusGeometry(0.119, 0.014, 8, 28), shirt, [0, 0.74, 0]); m.rotation.x = Math.PI / 2; }
    else if (accessory === 'cap') { add(u, new THREE.SphereGeometry(0.13, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), shirt, [0, 0.725, 0]); add(u, new THREE.BoxGeometry(0.17, 0.012, 0.11), shirt, [0, 0.735, 0.12]); }
    else if (accessory === 'shades') add(u, new THREE.BoxGeometry(0.18, 0.04, 0.02), '#0b0f1a', [0, 0.715, 0.108], { roughness: 0.2, metalness: 0.4 });

    // arms: [upper, fore] cylinders + joints, rebuilt each setSpec
    this.arms = [-1, 1].map(() => ({ upper: cyl(0.05, shirt), fore: cyl(0.04, skin), elbow: ball(0.045, skin), hand: ball(0.05, skin), shoulder: ball(0.058, shirt) }));
    this.group.userData.character = true;
  }

  /** Called every frame. `grip` is the paddle handle in world space. */
  update(dt, grip, followX = true) {
    const g = this.group, u = this.upper;
    this.t += dt;
    g.updateMatrixWorld(true);
    const target = g.worldToLocal(tmpB.copy(grip));

    // Walk sideways so the body stays roughly behind the paddle (world x), lean toward low shots.
    if (followX) {
      // stand a little to the paddle hand's side so the body doesn't hide the paddle from the camera behind
      const side = Math.cos(g.rotation.y) < 0 ? 1 : -1;
      const wantWorldX = THREE.MathUtils.clamp(grip.x * 0.85 + side * 0.42, -1.45, 1.45);
      g.position.x += (wantWorldX - g.position.x) * (1 - Math.exp(-dt * 8));
    }
    const wantLean = THREE.MathUtils.clamp((0.3 - grip.y) * 0.55, -0.12, 0.6);
    this.lean += (wantLean - this.lean) * (1 - Math.exp(-dt * 10));
    const wantTwist = THREE.MathUtils.clamp(target.x * 0.5, -0.45, 0.45); // turn the shoulders toward the paddle side
    this.twist += (wantTwist - this.twist) * (1 - Math.exp(-dt * 10));
    u.position.y = 0.85 + Math.sin(this.t * 2) * 0.004;
    u.rotation.set(this.lean, this.twist, 0);
    u.updateMatrix();

    const sR = tmpA.set(-SHOULDER_X, SHOULDER_Y, 0).applyMatrix4(u.matrix).clone();
    const sL = tmpA.set(SHOULDER_X, SHOULDER_Y, 0).applyMatrix4(u.matrix).clone();
    // left (free) hand rests in front of the hip and counter-swings a little
    const free = sL.clone().add(new THREE.Vector3(0.1 + this.twist * 0.1, -0.5 + Math.sin(this.t * 2) * 0.01, 0.2));
    const hands = [[sR, target.clone(), this.poleR], [sL, free, this.poleL]];
    hands.forEach(([S, T, pole], i) => {
      const elbow = this.elbow[i];
      solveArm(S, T, ARM.upper, ARM.fore, pole, elbow);
      const a = this.arms[i];
      span(a.upper, S, elbow); span(a.fore, elbow, T);
      a.elbow.position.copy(elbow); a.hand.position.copy(T); a.shoulder.position.copy(S);
    });
  }

  dispose() { this.clear(); }
}
