/**
 * driver-notifications-ack.js
 *
 * POST /.netlify/functions/driver-notifications-ack
 * Body: { notificationId: "..." }
 *
 * Marks a notification as acknowledged when driver taps "Got It".
 */

const { connectToDatabase, headers, handleOptions } = require('./utils/db');
const { ObjectId } = require('mongodb');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { notificationId } = JSON.parse(event.body || '{}');
    if (!notificationId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'notificationId required' }) };
    }

    const { db } = await connectToDatabase();

    await db.collection('driver_notifications').updateOne(
      { _id: new ObjectId(notificationId) },
      { $set: { acknowledged: true, acknowledgedAt: new Date() } }
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };

  } catch (err) {
    console.error('[driver-notifications-ack] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
