import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/street';
export const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
try {
  await client.connect();
} catch (e) {
  console.error(`Could not connect to MongoDB at ${uri.replace(/\/\/[^@]*@/, '//***@')}\n${e.message}`);
  process.exit(1);
}
export const db = client.db(); // database name comes from the URI path (default "street")

export const users = db.collection('users');
export const matches = db.collection('matches');
export const competitions = db.collection('competitions');
export const cmatches = db.collection('competition_matches');
const counters = db.collection('counters');

// Numeric ids (used in JWTs, websocket messages and URLs) come from an atomic counter per collection.
export async function nextId(name) {
  const r = await counters.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  return r.seq;
}

await Promise.all([
  users.createIndex({ usernameLower: 1 }, { unique: true }),
  users.createIndex({ rating: -1 }),
  matches.createIndex({ p1: 1, _id: -1 }),
  matches.createIndex({ p2: 1, _id: -1 }),
  competitions.createIndex({ inviteCode: 1 }, { unique: true, sparse: true }),
  competitions.createIndex({ status: 1, createdAt: -1 }),
  cmatches.createIndex({ competitionId: 1, round: 1, slot: 1 }, { unique: true }),
  cmatches.createIndex({ status: 1, readyAt: 1 }),
]);

export const now = () => Date.now();
export const isDup = (e) => e?.code === 11000;
