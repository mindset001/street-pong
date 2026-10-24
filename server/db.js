import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const file = process.env.DB_FILE || new URL('../data/street.db', import.meta.url).pathname;
if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
export const db = new DatabaseSync(file);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 1000,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  titles INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY,
  p1 INTEGER NOT NULL REFERENCES users(id),
  p2 INTEGER REFERENCES users(id),
  s1 INTEGER NOT NULL, s2 INTEGER NOT NULL,
  winner INTEGER REFERENCES users(id),
  kind TEXT NOT NULL,            -- ranked | competition | ai
  delta1 INTEGER NOT NULL DEFAULT 0, delta2 INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS matches_p1 ON matches(p1);
CREATE INDEX IF NOT EXISTS matches_p2 ON matches(p2);
CREATE TABLE IF NOT EXISTS competitions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  creator_id INTEGER NOT NULL REFERENCES users(id),
  size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',   -- open | running | finished
  champion_id INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS competition_players (
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (competition_id, user_id)
);
CREATE TABLE IF NOT EXISTS competition_matches (
  id INTEGER PRIMARY KEY,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  p1 INTEGER REFERENCES users(id),
  p2 INTEGER REFERENCES users(id),
  winner INTEGER REFERENCES users(id),
  s1 INTEGER, s2 INTEGER,
  status TEXT NOT NULL DEFAULT 'waiting',  -- waiting | ready | playing | done
  ready_at INTEGER,
  UNIQUE (competition_id, round, slot)
);
`);

export const now = () => Date.now();
export const q = {
  get: (sql, ...a) => db.prepare(sql).get(...a),
  all: (sql, ...a) => db.prepare(sql).all(...a),
  run: (sql, ...a) => db.prepare(sql).run(...a),
};
export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Migration: invite codes for competitions
if (!db.prepare('PRAGMA table_info(competitions)').all().some((c) => c.name === 'invite_code')) {
  db.exec('ALTER TABLE competitions ADD COLUMN invite_code TEXT');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS competitions_code ON competitions(invite_code)');
