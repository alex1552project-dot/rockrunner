// netlify/functions/rr-notify-dispatcher.js
// Sends SMS to all active Dispatcher-role users when a new delivery is added
//
// POST { addedBy, customer, address, deliveryDate, notes }

const { MongoClient } = require('mongodb');

let cachedDb = null;
async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  cachedDb = client.db('gotrocks');
  return cachedDb;
}

async function sendSms(to, body) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: process.env.TWILIO_PHONE_NUMBER, To: to, Body: body }).toString()
  });
  const data = await res.json();
  return { status: res.status, sid: data.sid, error: data.error_code || null };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { addedBy, customer, address, deliveryDate, notes } = payload;

  try {
    const db = await connectToDatabase();

    // Get all active Dispatcher-role users with a phone number
    const dispatchers = await db.collection('rockrunner_users').find({
      role: 'Dispatcher',
      active: { $ne: false },
      phone: { $exists: true, $ne: '' }
    }).toArray();

    if (!dispatchers.length) {
      console.warn('[rr-notify] No active dispatchers with phone numbers found');
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, sent: 0, warning: 'No dispatchers to notify' }) };
    }

    // Build message
    const dateStr = deliveryDate ? ` for ${deliveryDate}` : '';
    const notesStr = notes ? ` — "${notes}"` : '';
    const message = `🚛 New delivery added by ${addedBy || 'RockRunner'}${dateStr}:\n${customer || 'Unknown customer'}${address ? '\n' + address : ''}${notesStr}`;

    // Send to each dispatcher
    const results = await Promise.all(
      dispatchers.map(d => sendSms(d.phone, message))
    );

    console.log('[rr-notify] SMS results:', results);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, sent: results.filter(r => !r.error).length, results })
    };

  } catch (err) {
    console.error('[rr-notify] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
