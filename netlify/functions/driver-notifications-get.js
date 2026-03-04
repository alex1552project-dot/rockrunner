/**
 * driver-notifications-get.js
 *
 * GET /.netlify/functions/driver-notifications-get?truckId=xxx
 *
 * Returns all unacknowledged notifications for a truck,
 * scoped to today and tomorrow (America/Chicago).
 */

const { connectToDatabase, headers, handleOptions } = require('./utils/db');

function getChiDate(offset = 0) {
  const chi = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  if (offset) chi.setDate(chi.getDate() + offset);
  const pad = n => String(n).padStart(2, '0');
  return `${chi.getFullYear()}-${pad(chi.getMonth() + 1)}-${pad(chi.getDate())}`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const p = event.queryStringParameters || {};
  if (!p.truckId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'truckId required' }) };
  }

  try {
    const { db } = await connectToDatabase();

    const dates = [getChiDate(0), getChiDate(1)];

    const notifications = await db.collection('driver_notifications')
      .find({
        truckId:      p.truckId,
        acknowledged: false,
        date:         { $in: dates }
      })
      .sort({ createdAt: -1 })
      .toArray();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        notifications: notifications.map(n => ({
          _id:          n._id.toString(),
          message:      n.message,
          type:         n.type,
          customerName: n.customerName,
          date:         n.date,
          createdAt:    n.createdAt,
          acknowledged: n.acknowledged
        })),
        unreadCount: notifications.length
      })
    };

  } catch (err) {
    console.error('[driver-notifications-get] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
