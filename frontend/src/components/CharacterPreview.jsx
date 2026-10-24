import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Character } from '../game/character';
import { makePaddle } from '../game/scene';

/** Small self-contained 3D viewer: the player's character holding their paddle. Drag to rotate. */
export default function CharacterPreview({ char, paddle, height = 270 }) {
  const mount = useRef();
  const api = useRef({});

  useEffect(() => {
    const el = mount.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { el.textContent = '3D preview unavailable'; return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, height);
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'display:block;width:100%;touch-action:none;cursor:grab';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, el.clientWidth / height, 0.1, 20);
    camera.position.set(0, 0.95, 3.9); camera.lookAt(0, 0.76, 0);
    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x2a1d44, 1.0));
    const key = new THREE.DirectionalLight(0xfff2dd, 2.2); key.position.set(2, 4, 3); key.castShadow = true; scene.add(key);
    const rim = new THREE.PointLight(0x38d6ff, 6, 8); rim.position.set(-2, 1.5, -2); scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), new THREE.MeshStandardMaterial({ color: 0x1b2447, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

    const pivot = new THREE.Group(); scene.add(pivot);
    const character = new Character(char); pivot.add(character.group);
    const racket = makePaddle(paddle); pivot.add(racket);
    api.current = { character, racket, spin: 0.4 };

    let drag = null, raf, last = performance.now(), t = 0;
    const down = (e) => { drag = { x: e.clientX, r: pivot.rotation.y }; renderer.domElement.setPointerCapture(e.pointerId); renderer.domElement.style.cursor = 'grabbing'; };
    const move = (e) => { if (drag) pivot.rotation.y = drag.r + (e.clientX - drag.x) * 0.012; };
    const up = () => { drag = null; renderer.domElement.style.cursor = 'grab'; };
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('pointerup', up);

    const grip = new THREE.Vector3();
    const frame = (now) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now; t += dt;
      if (!drag) pivot.rotation.y += dt * 0.45;
      // the paddle gently "rallies" in front of the player
      racket.position.set(-0.3 + Math.sin(t * 2.4) * 0.08, 0.98 + Math.sin(t * 4.8) * 0.04, 0.42);
      racket.rotation.set(-0.3, Math.PI, Math.sin(t * 2.4) * 0.3);
      scene.updateMatrixWorld(true);
      grip.set(0, -0.15, 0.03).applyMatrix4(racket.matrixWorld);
      character.update(dt, grip, false);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onResize = () => { renderer.setSize(el.clientWidth, height); camera.aspect = el.clientWidth / height; camera.updateProjectionMatrix(); };
    addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf); removeEventListener('resize', onResize);
      character.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [height]);

  useEffect(() => { api.current.character?.setSpec(char); }, [char]);
  useEffect(() => { const m = api.current.racket?.userData.rubber; if (m) { m.color.set(paddle); m.emissive.set(paddle); } }, [paddle]);

  return <div ref={mount} data-testid="char-preview" style={{ width: '100%', height, borderRadius: 14, overflow: 'hidden', background: 'radial-gradient(circle at 50% 30%, #1f2a55, #0d1330)' }} />;
}
