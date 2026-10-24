import { MongoClient } from 'mongodb';

// Each test run gets its own throw-away database on the local MongoDB (override base with MONGODB_TEST_URL).
const base = process.env.MONGODB_TEST_URL || 'mongodb://127.0.0.1:27017';
export const TEST_URI = `${base}/street_test_${process.pid}_${Date.now()}`;

export async function dropTestDb() {
  const c = new MongoClient(TEST_URI, { serverSelectionTimeoutMS: 3000 });
  try { await c.connect(); await c.db().dropDatabase(); } finally { await c.close().catch(() => {}); }
}
