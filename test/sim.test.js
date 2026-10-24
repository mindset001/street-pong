import assert from 'node:assert/strict';
import { Game, C } from '../server/physics.js';
import { AI } from '../server/ai.js';

function play(l0, l1) {
  const g = new Game({ target: 11 });
  const a = [new AI(g, 0, l0), new AI(g, 1, l1)];
  const ev = { hit: 0, net: 0, out: 0, point: 0 };
  let steps = 0;
  while (!g.over && steps < 120 * 60 * 30) {
    a[0].update(C.DT); a[1].update(C.DT); g.step(); steps++;
    for (const e of g.events) if (e.e in ev) ev[e.e]++;
    g.events = [];
  }
  return { g, steps, ev };
}

let wins = [0, 0], rallies = 0, hits = 0;
for (let i = 0; i < 20; i++) {
  const { g, steps, ev } = play('hard', 'hard');
  assert.ok(g.over, 'game must finish');
  const [x, y] = g.score;
  assert.ok(Math.max(x, y) >= 11 && Math.abs(x - y) >= 2, `valid final score ${x}-${y}`);
  wins[g.winner]++; rallies += ev.point; hits += ev.hit;
}
console.log('hard vs hard: wins', wins, 'avg hits/point', (hits / rallies).toFixed(1));
const e = play('easy', 'hard');
console.log('easy vs hard score', e.g.score);
assert.ok(e.g.score[1] > e.g.score[0], 'hard AI should beat easy AI');
const m = play('medium', 'medium');
console.log('medium vs medium score', m.g.score, 'time(s)', (m.steps * C.DT).toFixed(0));
console.log('sim ok');
