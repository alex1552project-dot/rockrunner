// netlify/functions/rr-auth.js
// PIN authentication for RockRunner — validates against rockrunner_users in MongoDB
//
// POST { pin: "1234" } → { success, user: { name, role, phone } }
// GET                  → { users: [{ name, role }] } — active users list

const { MongoClient } = require('mongodb');
const crypto = require('crypto');

let cachedDb = null;
async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  cachedDb = client.db('gotrocks');
  return cachedDb;
}

function hashPin(pin) {
  return crypto.createHash('sha256').update(pin + (process.env.PIN_SALT || '')).digest('hex');
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  const db = await connectToDatabase();

  // GET — return active user list (names + roles, no PINs)
  if (event.httpMethod === 'GET') {
    const users = await db.collection('rockrunner_users')
      .find({ active: { $ne: false } })
      .sort({ name: 1 })
      .toArray();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ users: users.map(u => ({ name: u.name, role: u.role })) })
    };
  }

  // POST — verify PIN
  if (event.httpMethod === 'POST') {
    let pin;
    try {
      ({ pin } = JSON.parse(event.body || '{}'));
    } catch {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid JSON' }) };
    }

    if (!pin || !/^\d{4}$/.test(pin)) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'PIN must be 4 digits' }) };
    }

    const user = await db.collection('rockrunner_users').findOne({
      pinHash: hashPin(pin),
      active: { $ne: false }
    });

    if (!user) {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Invalid PIN' }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        user: { name: user.name, role: user.role, phone: user.phone || '' }
      })
    };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
