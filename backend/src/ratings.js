import { users, matches, nextId, now } from './db.js';

const K = 32;
/** Records a finished match and applies Elo for ranked/competition games. Returns rating deltas. */
export async function recordMatch({ p1, p2 = null, s1, s2, winner, kind }) {
  let d1 = 0, d2 = 0;
  if (p2 && (kind === 'ranked' || kind === 'competition') && winner) {
    const [a, b] = await Promise.all([users.findOne({ _id: p1 }), users.findOne({ _id: p2 })]);
    const ea = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
    d1 = Math.round(K * ((winner === p1 ? 1 : 0) - ea));
    d2 = -d1;
    await Promise.all([users.updateOne({ _id: p1 }, { $inc: { rating: d1 } }), users.updateOne({ _id: p2 }, { $inc: { rating: d2 } })]);
  }
  if (winner && kind !== 'ai') {
    const loser = winner === p1 ? p2 : p1;
    await users.updateOne({ _id: winner }, { $inc: { wins: 1 } });
    if (loser) await users.updateOne({ _id: loser }, { $inc: { losses: 1 } });
  }
  const _id = await nextId('matches');
  await matches.insertOne({ _id, p1, p2, s1, s2, winner, kind, delta1: d1, delta2: d2, createdAt: now() });
  return { id: _id, d1, d2 };
}
