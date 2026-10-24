import { q, tx, now } from './db.js';

const K = 32;
/** Records a finished match and applies Elo for ranked/competition games. Returns rating deltas [d1, d2]. */
export function recordMatch({ p1, p2 = null, s1, s2, winner, kind }) {
  return tx(() => {
    let d1 = 0, d2 = 0;
    if (p2 && (kind === 'ranked' || kind === 'competition') && winner) {
      const a = q.get('SELECT rating FROM users WHERE id = ?', p1).rating;
      const b = q.get('SELECT rating FROM users WHERE id = ?', p2).rating;
      const ea = 1 / (1 + 10 ** ((b - a) / 400));
      const sa = winner === p1 ? 1 : 0;
      d1 = Math.round(K * (sa - ea));
      d2 = -d1;
      q.run('UPDATE users SET rating = rating + ? WHERE id = ?', d1, p1);
      q.run('UPDATE users SET rating = rating + ? WHERE id = ?', d2, p2);
    }
    if (winner && kind !== 'ai') {
      const loser = winner === p1 ? p2 : p1;
      q.run('UPDATE users SET wins = wins + 1 WHERE id = ?', winner);
      if (loser) q.run('UPDATE users SET losses = losses + 1 WHERE id = ?', loser);
    }
    const r = q.run('INSERT INTO matches (p1,p2,s1,s2,winner,kind,delta1,delta2,created_at) VALUES (?,?,?,?,?,?,?,?,?)', p1, p2, s1, s2, winner, kind, d1, d2, now());
    return { id: Number(r.lastInsertRowid), d1, d2 };
  });
}
